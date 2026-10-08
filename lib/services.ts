// Shared service/stylist/schedule configuration for Sky Beauty Salon.
// Imported by both the public BookingSection and the staff dashboard booking form.
// No server-only imports — safe to use in client and server components.

export interface ServiceItem {
  id: string;
  label: string;
  price: string;
  duration: string;
  durationMins: number;
}

export interface ServiceCategory {
  id: string;
  label: string;
  priceRange: string;
  services: ServiceItem[];
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: "cut-style",
    label: "Hair Cut & Style",
    priceRange: "$30 – $85",
    services: [
      { id: "womens-cut",    label: "Women's Haircut",            price: "$70",          duration: "60 min",  durationMins: 60  },
      { id: "mens-cut",      label: "Men's Haircut",              price: "$35",          duration: "30 min",  durationMins: 30  },
      { id: "childrens-cut", label: "Children's Haircut",         price: "$30",          duration: "30 min",  durationMins: 30  },
      { id: "blow-dry",      label: "Blow Dry",                   price: "$40",          duration: "45 min",  durationMins: 45  },
      { id: "bridal",        label: "Formal / Up-do / Bridal",   price: "$85",          duration: "2 hrs",   durationMins: 120 },
    ],
  },
  {
    id: "color",
    label: "Color",
    priceRange: "$35 – $250",
    services: [
      { id: "touch-up",      label: "Touch Up",                   price: "$65",          duration: "90 min",  durationMins: 90  },
      { id: "sp-medium",     label: "Full Color — Medium Length", price: "$85",          duration: "90 min",  durationMins: 90  },
      { id: "sp-long",       label: "Full Color — Long Length",   price: "$120",         duration: "2 hrs",   durationMins: 120 },
      { id: "glaze",         label: "Glaze or Semi-Permanent",    price: "$55",          duration: "60 min",  durationMins: 60  },
      { id: "glaze-post",    label: "Glaze Post Color",           price: "$55",          duration: "30 min",  durationMins: 30  },
      { id: "b3-bond",       label: "B3 Color Add On",            price: "$60",          duration: "30 min",  durationMins: 30  },
      { id: "corrective2",   label: "Color Correction",           price: "$250",         duration: "3+ hrs",  durationMins: 180 },
    ],
  },
  {
    id: "highlight",
    label: "Highlight / Lowlight",
    priceRange: "$15 – $250",
    services: [
      { id: "hi-full",       label: "Full Highlights",            price: "$155",         duration: "2.5 hrs", durationMins: 150 },
      { id: "hi-partial",    label: "Partial Highlights",         price: "$135",         duration: "2 hrs",   durationMins: 120 },
      { id: "balayage",      label: "Balayage or Ombré",         price: "$250",         duration: "3 hrs",   durationMins: 180 },
      { id: "foils",         label: "Foils",                      price: "$15",          duration: "30 min",  durationMins: 30  },
      { id: "corrective",    label: "Corrective Color",           price: "Consultation", duration: "3+ hrs",  durationMins: 180 },
    ],
  },
  {
    id: "straightening",
    label: "Straightening Treatment / Perm",
    priceRange: "$30 – $300",
    services: [
      { id: "relaxer",       label: "Relaxer",                    price: "$65 – $100",   duration: "2 hrs",   durationMins: 120 },
      { id: "waves",         label: "Treatment Waves",            price: "$100",         duration: "90 min",  durationMins: 90  },
      { id: "keratin",       label: "Brazilian Keratin",          price: "$180",         duration: "2 hrs",   durationMins: 120 },
      { id: "blowout",       label: "Brazilian Blow Out",         price: "$180",         duration: "2 hrs",   durationMins: 120 },
      { id: "japanese",      label: "Japanese Straightening",     price: "$300",         duration: "3 hrs",   durationMins: 180 },
      { id: "botox",         label: "Hair Botox Treatment",       price: "$180",         duration: "90 min",  durationMins: 90  },
      { id: "cedula",        label: "Cedula Madres Treatment",    price: "$30",          duration: "45 min",  durationMins: 45  },
    ],
  },
  {
    id: "treatment",
    label: "Treatment",
    priceRange: "$30 – $100",
    services: [
      { id: "moroccan",      label: "Moroccan Oil Treatment",     price: "$30",          duration: "45 min",  durationMins: 45  },
      { id: "aveda",         label: "Aveda Dry or Damage Remedy", price: "$30 – $45",    duration: "45 min",  durationMins: 45  },
      { id: "b3-pkg",        label: "B3 Treatment / B3 Package",  price: "$60",          duration: "60 min",  durationMins: 60  },
      { id: "split-end",     label: "Split End Repairing",        price: "$40 – $100",   duration: "45 min",  durationMins: 45  },
    ],
  },
];

export const ALL_SERVICES: ServiceItem[] = SERVICE_CATEGORIES.flatMap(c => c.services);

export const STYLISTS: { id: string; label: string }[] = [
  { id: "joann", label: "Joann" },
  { id: "luis",  label: "Luis"  },
  { id: "rajni", label: "Rajni" },
];

// Slots available per day of week (0=Sun … 6=Sat). null = closed.
export const SCHEDULE: Record<number, string[] | null> = {
  0: ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],
  1: null,
  2: ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"],
  3: ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"],
  4: ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"],
  5: ["10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"],
  6: ["10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM"],
};

// Map display time strings to 24-hour values for ISO datetime construction
export const TIME_TO_HOUR: Record<string, number> = {
  "9:00 AM": 9, "10:00 AM": 10, "11:00 AM": 11,
  "12:00 PM": 12, "1:00 PM": 13, "2:00 PM": 14,
  "3:00 PM": 15, "4:00 PM": 16, "5:00 PM": 17, "6:00 PM": 18,
};

export const TIME_SLOTS: string[] = [
  "9:00 AM", "10:00 AM", "11:00 AM",
  "12:00 PM", "1:00 PM", "2:00 PM",
  "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM",
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-stylist schedule overrides
// Omit a stylist entry to fall back to the global SCHEDULE above.
// closeHour: the latest end-time allowed for that day (24h). Slots where
//   startHour + durationMins/60 > closeHour are hidden from the picker.
// ─────────────────────────────────────────────────────────────────────────────

export interface StylistConfig {
  schedule: Record<number, string[] | null>;
  closeHour: Partial<Record<number, number>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// One-off blocked dates per stylist (YYYY-MM-DD, salon timezone)
// Add a date here when a stylist is out for a specific day.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLIST_BLOCKED_DATES: Record<string, string[]> = {
  joann: ['2026-10-10'],
};

export function isStylistDateBlocked(stylistId: string, dateISO: string): boolean {
  return (STYLIST_BLOCKED_DATES[stylistId] ?? []).includes(dateISO);
}

export const STYLIST_SCHEDULE: Record<string, StylistConfig> = {
  luis: {
    schedule: {
      0: null,  // Sun — unavailable
      1: null,  // Mon — unavailable
      2: null,  // Tue — unavailable
      3: null,  // Wed — unavailable
      4: null,  // Thu — unavailable
      5: ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],  // Fri 11–5
      6: ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"],  // Sat 11–5
    },
    closeHour: { 5: 17, 6: 17 },
  },
};

/**
 * Returns available time slots for a stylist on a given day of week.
 * Falls back to the global SCHEDULE for stylists not in STYLIST_SCHEDULE.
 * When durationMins is supplied, slots where the service would end after the
 * stylist's closing hour are excluded.
 */
export function getStylistSlots(
  stylistId: string,
  dayOfWeek: number,
  durationMins?: number,
  dateISO?: string
): string[] {
  if (dateISO && isStylistDateBlocked(stylistId, dateISO)) return [];

  const config = STYLIST_SCHEDULE[stylistId];
  const base: string[] = config
    ? [...(config.schedule[dayOfWeek] ?? [])]
    : [...(SCHEDULE[dayOfWeek] ?? [])];

  const closeHour = config?.closeHour[dayOfWeek];
  if (!durationMins || closeHour === undefined) return base;

  return base.filter(slot => {
    const h = TIME_TO_HOUR[slot];
    return h !== undefined && h + durationMins / 60 <= closeHour;
  });
}

/**
 * Returns true if the stylist has any available slots on the given day of week.
 * Ignores duration — used only to decide whether a calendar date is selectable.
 */
export function isStylistAvailableOnDay(stylistId: string, dayOfWeek: number): boolean {
  const config = STYLIST_SCHEDULE[stylistId];
  if (config) return (config.schedule[dayOfWeek] ?? []).length > 0;
  return SCHEDULE[dayOfWeek] !== null;
}
