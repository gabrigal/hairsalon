"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_CATEGORIES, ALL_SERVICES, STYLISTS, TIME_TO_HOUR, getStylistSlots, isStylistAvailableOnDay, isStylistDateBlocked } from "@/lib/services";
import type { BookingSource } from "@/lib/database.types";

interface CustomerResult {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
}

const SOURCE_OPTIONS: { value: Exclude<BookingSource, 'online_booking' | 'historical_import' | 'manual'>; label: string }[] = [
  { value: "walk_in",   label: "Walk-in"    },
  { value: "phone",     label: "Phone call" },
  { value: "instagram", label: "Instagram"  },
  { value: "other",     label: "Other"      },
];

export default function NewAppointmentForm() {
  const router = useRouter();

  // ── Customer ────────────────────────────────────────────────────────────────
  const [customerMode, setCustomerMode] = useState<"search" | "new">("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CustomerResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Appointment ─────────────────────────────────────────────────────────────
  const [service, setService] = useState("");
  const [stylist, setStylist] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [price, setPrice] = useState("");
  const [bookingSource, setBookingSource] = useState<"walk_in" | "phone" | "instagram" | "other">("walk_in");
  const [notes, setNotes] = useState("");

  // ── Submission ──────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/dashboard/customers/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSearchResults(data.customers ?? []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, []);

  const selectCustomer = useCallback((c: CustomerResult) => {
    setSelectedCustomer(c);
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setEmail(c.email ?? "");
    setPhone(c.phone ?? "");
    setSearchQuery("");
    setShowDropdown(false);
    setCustomerMode("search");
  }, []);

  const clearCustomer = useCallback(() => {
    setSelectedCustomer(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
  }, []);

  // Auto-fill duration and price when service changes
  const handleServiceChange = useCallback((svcId: string) => {
    setService(svcId);
    const svc = ALL_SERVICES.find(s => s.id === svcId);
    if (svc) {
      setDurationMinutes(svc.durationMins);
      setPrice(svc.price);
    }
  }, []);

  // Available time slots for the selected date, respecting per-stylist schedule, duration cutoff, and blocked dates
  const dayOfWeek = date ? new Date(`${date}T12:00:00`).getDay() : -1;
  const availableSlots: string[] = dayOfWeek >= 0
    ? getStylistSlots(stylist || '', dayOfWeek, durationMinutes, date || undefined)
    : [];
  const isClosed = dayOfWeek >= 0 && (
    stylist
      ? (isStylistDateBlocked(stylist, date) || !isStylistAvailableOnDay(stylist, dayOfWeek))
      : availableSlots.length === 0
  );

  // Reset time when date changes and current time is no longer available
  useEffect(() => {
    if (time && !availableSlots.includes(time)) {
      setTime("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const fName = selectedCustomer ? selectedCustomer.first_name : firstName.trim();
    const lName = selectedCustomer ? selectedCustomer.last_name : lastName.trim();
    const cEmail = selectedCustomer ? (selectedCustomer.email ?? "") : email.trim();
    const cPhone = selectedCustomer ? (selectedCustomer.phone ?? "") : phone.trim();

    if (!fName) { setError("First name is required."); return; }
    if (!service) { setError("Please select a service."); return; }
    if (!stylist) { setError("Please select a stylist."); return; }
    if (!date) { setError("Please select a date."); return; }
    if (!time) { setError("Please select a time."); return; }
    if (cEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cEmail)) {
      setError("Email address is not valid."); return;
    }
    if (!(time in TIME_TO_HOUR)) { setError("Invalid time slot selected."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer?.id ?? null,
          firstName: fName,
          lastName: lName,
          email: cEmail || null,
          phone: cPhone || null,
          service,
          stylist,
          date,
          time,
          durationMinutes,
          price,
          bookingSource,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      router.push(`/dashboard/appointments/${data.appointmentId}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Min date for the date picker (today) ────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">

      {/* ── Customer ─────────────────────────────────────────────────────────── */}
      <section className="bg-white border border-[#DDDDDD] p-6">
        <h2 className="text-xs tracking-widest uppercase text-[#777777] mb-4">Customer</h2>

        {selectedCustomer ? (
          /* Selected customer display */
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-[#000000]">
                {selectedCustomer.first_name} {selectedCustomer.last_name}
              </p>
              {selectedCustomer.email && (
                <p className="text-sm text-[#777777]">{selectedCustomer.email}</p>
              )}
              {selectedCustomer.phone && (
                <p className="text-sm text-[#777777]">{selectedCustomer.phone}</p>
              )}
              <p className="text-xs text-green-600 mt-1">Existing customer</p>
            </div>
            <button
              type="button"
              onClick={clearCustomer}
              className="text-xs text-[#777777] underline hover:text-[#000000] shrink-0"
            >
              Clear
            </button>
          </div>
        ) : customerMode === "search" ? (
          <div className="space-y-3">
            {/* Search box */}
            <div ref={searchRef} className="relative">
              <input
                type="text"
                placeholder="Search by name, email, or phone…"
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
              />
              {searchLoading && (
                <span className="absolute right-3 top-2.5 text-xs text-[#999999]">Searching…</span>
              )}
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 bg-white border border-[#DDDDDD] border-t-0 shadow-sm max-h-56 overflow-y-auto">
                  {searchResults.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-[#F8F8F8] text-sm border-b border-[#EEEEEE] last:border-b-0"
                    >
                      <span className="font-medium text-[#000000]">{c.first_name} {c.last_name}</span>
                      {c.email && <span className="text-[#777777] ml-2">{c.email}</span>}
                      {c.phone && <span className="text-[#999999] ml-2 text-xs">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              {showDropdown && searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
                <div className="absolute left-0 right-0 top-full z-10 bg-white border border-[#DDDDDD] border-t-0 shadow-sm px-3 py-2 text-sm text-[#777777]">
                  No existing customers found.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCustomerMode("new")}
              className="text-xs text-[#777777] underline hover:text-[#000000]"
            >
              + Create new customer
            </button>
          </div>
        ) : (
          /* New customer fields */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Optional — for confirmation"
                  className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
                />
              </div>
              <div>
                <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCustomerMode("search")}
              className="text-xs text-[#777777] underline hover:text-[#000000]"
            >
              ← Search existing customers instead
            </button>
          </div>
        )}
      </section>

      {/* ── Appointment ──────────────────────────────────────────────────────── */}
      <section className="bg-white border border-[#DDDDDD] p-6">
        <h2 className="text-xs tracking-widest uppercase text-[#777777] mb-4">Appointment</h2>

        <div className="space-y-4">
          {/* Service */}
          <div>
            <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
              Service <span className="text-red-500">*</span>
            </label>
            <select
              value={service}
              onChange={e => handleServiceChange(e.target.value)}
              className="w-full border border-[#DDDDDD] px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#000000]"
              required
            >
              <option value="">Select a service…</option>
              {SERVICE_CATEGORIES.map(cat => (
                <optgroup key={cat.id} label={cat.label}>
                  {cat.services.map(svc => (
                    <option key={svc.id} value={svc.id}>
                      {svc.label} — {svc.price} ({svc.duration})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Stylist */}
          <div>
            <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
              Stylist <span className="text-red-500">*</span>
            </label>
            <select
              value={stylist}
              onChange={e => setStylist(e.target.value)}
              className="w-full border border-[#DDDDDD] px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#000000]"
              required
            >
              <option value="">Select a stylist…</option>
              {STYLISTS.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                min={today}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
                required
              />
              {isClosed && (
                <p className="text-xs text-red-500 mt-1">Salon is closed on Mondays.</p>
              )}
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                Time <span className="text-red-500">*</span>
              </label>
              <select
                value={time}
                onChange={e => setTime(e.target.value)}
                disabled={!date || isClosed}
                className="w-full border border-[#DDDDDD] px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#000000] disabled:bg-[#F8F8F8] disabled:text-[#AAAAAA]"
                required
              >
                <option value="">{date ? (isClosed ? "Closed" : "Select time…") : "Select date first…"}</option>
                {availableSlots.map(slot => (
                  <option key={slot} value={slot}>{slot}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Duration and Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                Duration (minutes)
              </label>
              <input
                type="number"
                min={15}
                step={15}
                value={durationMinutes}
                onChange={e => setDurationMinutes(Math.max(15, parseInt(e.target.value) || 60))}
                className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
              />
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
                Price
              </label>
              <input
                type="text"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="e.g. $70"
                className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000]"
              />
            </div>
          </div>

          {/* Booking Source */}
          <div>
            <label className="block text-xs tracking-widest uppercase text-[#777777] mb-2">
              How did they book? <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-3">
              {SOURCE_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bookingSource"
                    value={opt.value}
                    checked={bookingSource === opt.value}
                    onChange={() => setBookingSource(opt.value)}
                    className="accent-black"
                  />
                  <span className="text-sm text-[#000000]">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs tracking-widest uppercase text-[#777777] mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional — special requests, color formula, etc."
              className="w-full border border-[#DDDDDD] px-3 py-2 text-sm focus:outline-none focus:border-[#000000] resize-y"
            />
          </div>
        </div>
      </section>

      {/* ── Error + Submit ────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || isClosed}
        className="w-full bg-[#000000] text-white text-xs tracking-widest uppercase py-3 hover:bg-[#333333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Creating appointment…" : "Create Appointment"}
      </button>
    </form>
  );
}
