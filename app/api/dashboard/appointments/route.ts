import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient, createServiceClient } from '@/lib/supabase/server';
import { findOrCreateCustomer } from '@/lib/db/customers';
import {
  createAppointment,
  confirmAppointment,
  markNeedsReconciliation,
} from '@/lib/db/appointments';
import { logEvent } from '@/lib/db/events';
import { scheduleReminder } from '@/lib/db/automationJobs';
import { cancelCustomerRetentionJobs } from '@/lib/db/retentionJobs';
import type { BookingSource } from '@/lib/database.types';
import { TIME_TO_HOUR, getStylistSlots } from '@/lib/services';

const BUSINESS_ID = process.env.SALON_BUSINESS_ID!;
const N8N_BOOKING_WEBHOOK_URL = process.env.N8N_BOOKING_WEBHOOK_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const N8N_TIMEOUT_MS = 10_000;

interface StaffBookingBody {
  customerId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  service: string;
  stylist: string;
  date: string;       // YYYY-MM-DD
  time: string;       // e.g. "2:00 PM"
  durationMinutes: number;
  price: string;      // e.g. "$70" or "Consultation"
  bookingSource: BookingSource;
  notes?: string | null;
}

export async function POST(request: NextRequest) {
  if (!BUSINESS_ID) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  // ── Auth check ────────────────────────────────────────────────────────────
  const ssrClient = await createSSRClient();
  const { data: { user } } = await ssrClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: StaffBookingBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const {
    firstName, lastName, service, stylist,
    date, time, durationMinutes, price, bookingSource, notes,
  } = body;
  const email = body.email?.trim() || null;
  const phone = body.phone?.trim() || null;

  if (!firstName?.trim() || !service || !stylist || !date || !time) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const hour = TIME_TO_HOUR[time];
  if (hour === undefined) {
    return NextResponse.json({ error: 'Invalid time slot' }, { status: 400 });
  }

  // ── Validate time slot against stylist's schedule ──────────────────────────
  const bookingDayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const validSlots = getStylistSlots(stylist, bookingDayOfWeek, durationMinutes ?? 60, date);
  if (!validSlots.includes(time)) {
    return NextResponse.json(
      { error: 'That time is not available for the selected stylist.' },
      { status: 400 }
    );
  }

  // ── Build local ET datetime strings ───────────────────────────────────────
  const startH = String(hour).padStart(2, '0');
  const startISO = `${date}T${startH}:00:00`;
  const endTotalMins = hour * 60 + (durationMinutes ?? 60);
  const endH = String(Math.floor(endTotalMins / 60)).padStart(2, '0');
  const endM = String(endTotalMins % 60).padStart(2, '0');
  const endISO = `${date}T${endH}:${endM}:00`;

  const appointmentAt = toUTC(startISO);
  const appointmentEndAt = toUTC(endISO);

  const supabase = createServiceClient();

  // ── Find or create customer ───────────────────────────────────────────────
  let customer;
  try {
    customer = await findOrCreateCustomer(supabase, {
      businessId: BUSINESS_ID,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email,
      phone,
      source: 'manual',
    });
  } catch (err) {
    console.error('[dashboard/appointments] findOrCreateCustomer failed:', err);
    return NextResponse.json({ error: 'Could not create customer record' }, { status: 500 });
  }

  // ── Parse price to cents ──────────────────────────────────────────────────
  const priceCents = parsePriceCents(price);

  // ── Create pending appointment ────────────────────────────────────────────
  let created;
  try {
    created = await createAppointment(supabase, {
      businessId: BUSINESS_ID,
      customerId: customer.id,
      service,
      stylist,
      appointmentAt,
      appointmentEndAt,
      durationMinutes: durationMinutes ?? 60,
      priceCents,
      bookingSource,
      notes: notes ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('exclusion constraint') || msg.includes('overlaps')) {
      return NextResponse.json(
        { error: 'That time slot is not available for this stylist. Please choose another time.' },
        { status: 409 }
      );
    }
    console.error('[dashboard/appointments] createAppointment failed:', msg);
    return NextResponse.json({ error: 'Could not create appointment' }, { status: 500 });
  }

  const { appointment, rawToken, gcalEventId } = created;
  const manageUrl = `${APP_URL}/manage/${rawToken}`;

  const customerName = `${customer.first_name} ${customer.last_name}`.trim();
  const [yearStr, monthStr, dayStr] = date.split('-');
  const dateObj = new Date(`${date}T12:00:00`);
  const dateDisplay = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // ── Call n8n booking webhook ───────────────────────────────────────────────
  // Always call to ensure Google Calendar stays in sync.
  // If no customer email, the customer email branch in n8n will be skipped.
  // On n8n failure we mark needs_reconciliation rather than blocking the booking.
  void yearStr; void monthStr; void dayStr; // used above

  const n8nPayload = {
    appointment_id: appointment.id,
    gcal_event_id: gcalEventId,
    customerName,
    customerEmail: customer.email ?? '',
    customerPhone: customer.phone ?? 'Not provided',
    stylist,
    service,
    date: dateDisplay,
    dateISO: date,
    time,
    startISO,
    endISO,
    price_display: price,
    duration: durationMinsToDisplay(durationMinutes ?? 60),
    manage_appointment_url: manageUrl,
    cancel_url: `${manageUrl}?action=cancel`,
    reschedule_url: `${manageUrl}?action=reschedule`,
  };

  let reconciliationNeeded = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

    const n8nRes = await fetch(N8N_BOOKING_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!n8nRes.ok) {
      const errText = await n8nRes.text().catch(() => 'unknown');
      console.error('[dashboard/appointments] n8n error:', n8nRes.status, errText);
      await markNeedsReconciliation(supabase, appointment.id, 'calendar_create');
      reconciliationNeeded = true;
    } else {
      const n8nData = await n8nRes.json().catch(() => ({}));
      const calendarEventId: string | null = n8nData?.calendarEventId ?? null;

      if (n8nData?.success && calendarEventId) {
        await confirmAppointment(supabase, appointment.id, calendarEventId);
      } else {
        await markNeedsReconciliation(supabase, appointment.id, 'calendar_create');
        reconciliationNeeded = true;
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      await markNeedsReconciliation(supabase, appointment.id, 'calendar_create');
      reconciliationNeeded = true;
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[dashboard/appointments] n8n fetch failed:', msg);
      await markNeedsReconciliation(supabase, appointment.id, 'calendar_create');
      reconciliationNeeded = true;
    }
  }

  // ── Log, schedule reminder, cancel retention jobs ─────────────────────────
  await logEvent(supabase, {
    businessId: BUSINESS_ID,
    appointmentId: appointment.id,
    customerId: customer.id,
    eventType: 'appointment_created',
    metadata: {
      service,
      stylist,
      appointment_at: appointmentAt,
      booking_source: bookingSource,
      staff_user_id: user.id,
      gcal_sync: reconciliationNeeded ? 'pending_reconciliation' : 'synced',
    },
  });

  if (!reconciliationNeeded) {
    await scheduleReminder(supabase, {
      appointmentId: appointment.id,
      businessId: BUSINESS_ID,
      customerId: customer.id,
      appointmentAt,
    });
    await cancelCustomerRetentionJobs(supabase, customer.id, BUSINESS_ID);
  }

  return NextResponse.json({
    success: true,
    appointmentId: appointment.id,
    reconciliationNeeded,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toUTC(localISO: string): string {
  const [datePart] = localISO.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const offset = isEasternDST(year, month, day) ? '-04:00' : '-05:00';
  return new Date(`${localISO}${offset}`).toISOString();
}

function isEasternDST(year: number, month: number, day: number): boolean {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  const firstOfMonth = new Date(year, month - 1, 1).getDay();
  if (month === 3) {
    const secondSunday = 1 + (7 - firstOfMonth) % 7 + 7;
    return day >= secondSunday;
  } else {
    const firstSunday = 1 + (7 - firstOfMonth) % 7;
    return day < firstSunday;
  }
}

function parsePriceCents(price: string): number | null {
  const match = price.replace(/,/g, '').match(/\$?([\d.]+)/);
  if (!match) return null;
  return Math.round(parseFloat(match[1]) * 100);
}

function durationMinsToDisplay(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? '1 hr' : `${h} hrs`;
  return `${h} hr ${m} min`;
}
