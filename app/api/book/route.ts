import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { findOrCreateCustomer } from '@/lib/db/customers';
import {
  createAppointment,
  confirmAppointment,
  failAppointmentSync,
  markNeedsReconciliation,
} from '@/lib/db/appointments';
import { logEvent } from '@/lib/db/events';
import { scheduleReminder } from '@/lib/db/automationJobs';
import { cancelCustomerRetentionJobs } from '@/lib/db/retentionJobs';
import { getStylistSlots } from '@/lib/services';

const BUSINESS_ID = process.env.SALON_BUSINESS_ID!;
const N8N_BOOKING_WEBHOOK_URL = process.env.N8N_BOOKING_WEBHOOK_URL!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const N8N_TIMEOUT_MS = 10_000;

interface BookingPayload {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  stylist: string;
  service: string;
  date: string;
  dateISO: string;
  time: string;
  startISO: string;
  endISO: string;
  price: string;
  duration: string;
}

export async function POST(request: NextRequest) {
  // ── Env var guard ──────────────────────────────────────────────────────────
  if (!BUSINESS_ID) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  // ── Parse & validate body ──────────────────────────────────────────────────
  let body: BookingPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const {
    customerName, customerEmail, stylist, service,
    date, dateISO, time, startISO, endISO, price, duration,
  } = body;
  const customerPhone = body.customerPhone ?? '';

  if (!customerName || !customerEmail || !stylist || !service || !startISO || !endISO) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  // ── Validate time slot against stylist's schedule ──────────────────────────
  if (time && dateISO) {
    const dayOfWeek = new Date(`${dateISO}T12:00:00`).getDay();
    const durationMins = parseDurationMinutes(duration ?? '');
    const validSlots = getStylistSlots(stylist, dayOfWeek, durationMins, dateISO);
    if (!validSlots.includes(time)) {
      return NextResponse.json(
        { error: 'That time is not available for the selected stylist.' },
        { status: 400 }
      );
    }
  }

  // ── Convert local time to UTC (times come in as America/New_York local) ───
  // startISO is like "2025-05-14T14:00:00" (no tz suffix) — treat as ET
  const appointmentAt = toUTC(startISO);
  const appointmentEndAt = toUTC(endISO);

  const supabase = createServiceClient();

  // ── Server-side availability check (DB layer) ──────────────────────────────
  // Note: GCal FreeBusy is still checked by the browser before submission.
  // The DB check provides the authoritative slot-locking via the EXCLUDE constraint.
  // (A 409 from the INSERT will surface as a constraint violation if concurrent.)

  // ── Parse name ─────────────────────────────────────────────────────────────
  const nameParts = customerName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? customerName;
  const lastName = nameParts.slice(1).join(' ') || '';

  // ── Upsert customer ────────────────────────────────────────────────────────
  let customer;
  try {
    customer = await findOrCreateCustomer(supabase, {
      businessId: BUSINESS_ID,
      firstName,
      lastName,
      email: customerEmail,
      phone: customerPhone || null,
      source: 'online_booking',
    });
  } catch (err) {
    console.error('[/api/book] findOrCreateCustomer failed:', err);
    return NextResponse.json({ error: 'Could not create customer record' }, { status: 500 });
  }

  // ── Parse duration in minutes ──────────────────────────────────────────────
  const durationMinutes = parseDurationMinutes(duration);

  // ── Parse price to cents ───────────────────────────────────────────────────
  const priceCents = parsePriceCents(price);

  // ── Create pending appointment ─────────────────────────────────────────────
  let created;
  try {
    created = await createAppointment(supabase, {
      businessId: BUSINESS_ID,
      customerId: customer.id,
      service,
      stylist,
      appointmentAt,
      appointmentEndAt,
      durationMinutes,
      priceCents,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // EXCLUDE constraint violation = slot unavailable
    if (msg.includes('exclusion constraint') || msg.includes('overlaps')) {
      return NextResponse.json(
        { error: 'That time slot is no longer available. Please choose another time.' },
        { status: 409 }
      );
    }
    console.error('[/api/book] createAppointment failed:', msg);
    return NextResponse.json({ error: 'Could not create appointment' }, { status: 500 });
  }

  const { appointment, rawToken, gcalEventId } = created;
  const manageUrl = `${APP_URL}/manage/${rawToken}`;

  // ── Call n8n booking webhook (server-side, 10s timeout) ───────────────────
  const n8nPayload = {
    appointment_id: appointment.id,
    gcal_event_id: gcalEventId,
    customerName,
    customerEmail,
    customerPhone: customerPhone || 'Not provided',
    stylist,
    service,
    date,
    dateISO,
    time,
    startISO,
    endISO,
    price_display: price,
    duration,
    manage_appointment_url: manageUrl,
    cancel_url: `${manageUrl}?action=cancel`,
    reschedule_url: `${manageUrl}?action=reschedule`,
  };

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
      await failAppointmentSync(supabase, appointment.id, `n8n error ${n8nRes.status}: ${errText}`);
      await logEvent(supabase, {
        businessId: BUSINESS_ID,
        appointmentId: appointment.id,
        customerId: customer.id,
        eventType: 'automation_failed',
        metadata: { operation: 'calendar_create', error: errText, status: n8nRes.status },
      });
      return NextResponse.json(
        { error: 'Booking could not be confirmed. Please call us directly or try again.' },
        { status: 502 }
      );
    }

    const n8nData = await n8nRes.json().catch(() => ({}));
    const calendarEventId: string | null = n8nData?.calendarEventId ?? null;

    if (!n8nData?.success || !calendarEventId) {
      const errMsg = n8nData?.error ?? 'n8n did not return calendar event ID';
      await failAppointmentSync(supabase, appointment.id, errMsg);
      await logEvent(supabase, {
        businessId: BUSINESS_ID,
        appointmentId: appointment.id,
        customerId: customer.id,
        eventType: 'automation_failed',
        metadata: { operation: 'calendar_create', error: errMsg },
      });
      return NextResponse.json(
        { error: 'Booking could not be confirmed. Please call us directly or try again.' },
        { status: 502 }
      );
    }

    // ── Success ───────────────────────────────────────────────────────────────
    await confirmAppointment(supabase, appointment.id, calendarEventId);
    await logEvent(supabase, {
      businessId: BUSINESS_ID,
      appointmentId: appointment.id,
      customerId: customer.id,
      eventType: 'appointment_created',
      metadata: { service, stylist, appointment_at: appointmentAt, gcal_event_id: calendarEventId },
    });
    // Schedule 24h reminder if appointment is more than 24h away
    await scheduleReminder(supabase, {
      appointmentId: appointment.id,
      businessId: BUSINESS_ID,
      customerId: customer.id,
      appointmentAt,
    });

    // Cancel any pending rebooking/reactivation jobs — customer just rebooked
    await cancelCustomerRetentionJobs(supabase, customer.id, BUSINESS_ID);

    return NextResponse.json({ success: true, appointmentId: appointment.id });

  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Timeout — unknown whether GCal event was created
      await markNeedsReconciliation(supabase, appointment.id, 'calendar_create');
      return NextResponse.json(
        {
          success: false,
          pending: true,
          message: "We're confirming your appointment — you'll receive a confirmation email shortly. If you don't hear from us, please call.",
        },
        { status: 202 }
      );
    }

    const msg = err instanceof Error ? err.message : String(err);
    await failAppointmentSync(supabase, appointment.id, msg);
    await logEvent(supabase, {
      businessId: BUSINESS_ID,
      appointmentId: appointment.id,
      customerId: customer.id,
      eventType: 'automation_failed',
      metadata: { operation: 'calendar_create', error: msg },
    });
    return NextResponse.json(
      { error: 'Booking could not be confirmed. Please call us directly or try again.' },
      { status: 502 }
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a local datetime string like "2025-05-14T14:00:00" (no tz suffix)
 * from America/New_York into a UTC ISO string for database storage.
 *
 * Uses DST-aware calculation: US Eastern is UTC-5 (EST) or UTC-4 (EDT).
 * DST runs from the second Sunday of March to the first Sunday of November.
 */
function toUTC(localISO: string): string {
  const [datePart] = localISO.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const offset = isEasternDST(year, month, day) ? '-04:00' : '-05:00';
  return new Date(`${localISO}${offset}`).toISOString();
}

function isEasternDST(year: number, month: number, day: number): boolean {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  const firstOfMonth = new Date(year, month - 1, 1).getDay(); // 0=Sun
  if (month === 3) {
    const secondSunday = 1 + (7 - firstOfMonth) % 7 + 7;
    return day >= secondSunday;
  } else {
    const firstSunday = 1 + (7 - firstOfMonth) % 7;
    return day < firstSunday;
  }
}

function parseDurationMinutes(duration: string): number {
  const hrMatch = duration.match(/(\d+)\s*hr/);
  const minMatch = duration.match(/(\d+)\s*min/);
  return (hrMatch ? parseInt(hrMatch[1]) * 60 : 0) +
         (minMatch ? parseInt(minMatch[1]) : 0) || 60;
}

function parsePriceCents(price: string): number | null {
  const match = price.replace(/,/g, '').match(/\$?([\d.]+)/);
  if (!match) return null;
  return Math.round(parseFloat(match[1]) * 100);
}
