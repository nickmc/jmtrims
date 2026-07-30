"use server";

import { db } from "@/lib/db";
import {
  isOpenDay,
  isPastSlot,
  isValidPhoneNumber,
  slotsForDay,
  slotStartUtc,
  SLOT_MINUTES,
} from "@/lib/booking";
import { addBookingToCalendar, getBusyPeriods, type BusyPeriod } from "@/lib/calendar";
import type { StatementResultingChanges } from "node:sqlite";

export type SlotAvailability = { time: string; available: boolean };

function overlapsBusyPeriod(
  date: string,
  time: string,
  busyPeriods: BusyPeriod[] | null
): boolean {
  if (!busyPeriods || busyPeriods.length === 0) return false;
  const slotStart = slotStartUtc(date, time);
  const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60_000);
  return busyPeriods.some(
    (period) => slotStart < period.end && slotEnd > period.start
  );
}

export async function getAvailability(
  date: string
): Promise<{ open: boolean; slots: SlotAvailability[] }> {
  if (!isOpenDay(date)) {
    return { open: false, slots: [] };
  }

  const booked = db
    .prepare(
      "SELECT starts_at FROM appointments WHERE starts_at LIKE ? AND cancelled_at IS NULL"
    )
    .all(`${date}T%`) as { starts_at: string }[];

  const bookedTimes = new Set(booked.map((row) => row.starts_at.slice(11, 16)));

  // Anything the owner has manually put in Apple Calendar (a day off, an
  // appointment elsewhere) blocks the overlapping slots too — see
  // lib/calendar.ts's getBusyPeriods for how that's told apart from the
  // site's own booking events.
  const busyPeriods = await getBusyPeriods(date);

  const slots = slotsForDay().map((time) => ({
    time,
    available:
      !bookedTimes.has(time) &&
      !isPastSlot(date, time) &&
      !overlapsBusyPeriod(date, time, busyPeriods),
  }));

  return { open: true, slots };
}

export type BookingInput = {
  date: string;
  time: string;
  name: string;
  phone: string;
  location: string;
  notes: string;
};

export type BookingResult = { ok: true } | { ok: false; error: string };

export async function createBooking(
  input: BookingInput
): Promise<BookingResult> {
  const { date, time, name, phone, location, notes } = input;

  if (!isOpenDay(date)) {
    return { ok: false, error: "That day isn't available for bookings." };
  }
  if (!slotsForDay().includes(time)) {
    return { ok: false, error: "That time slot isn't valid." };
  }
  if (isPastSlot(date, time)) {
    return { ok: false, error: "That time has already passed." };
  }
  if (overlapsBusyPeriod(date, time, await getBusyPeriods(date))) {
    return { ok: false, error: "That slot was just booked — please pick another." };
  }
  if (!name.trim() || !phone.trim() || !location.trim()) {
    return { ok: false, error: "Name, phone, and location are all required." };
  }
  if (!isValidPhoneNumber(phone)) {
    return {
      ok: false,
      error: "Please enter a valid UK phone number, e.g. 07123 456789.",
    };
  }

  const startsAt = `${date}T${time}`;
  let changes: StatementResultingChanges;

  try {
    changes = db
      .prepare(
        "INSERT INTO appointments (name, phone, location, starts_at, notes) VALUES (?, ?, ?, ?, ?)"
      )
      .run(name.trim(), phone.trim(), location.trim(), startsAt, notes.trim() || null);
  } catch (error) {
    console.error("Failed to create booking:", error);
    return {
      ok: false,
      error: "That slot was just booked — please pick another.",
    };
  }

  try {
    const calendarObjectUrl = await addBookingToCalendar({
      name: name.trim(),
      phone: phone.trim(),
      location: location.trim(),
      notes: notes.trim(),
      date,
      time,
    });

    if (calendarObjectUrl) {
      db.prepare(
        "UPDATE appointments SET calendar_object_url = ? WHERE id = ?"
      ).run(calendarObjectUrl, changes.lastInsertRowid);
    }
  } catch (error) {
    // The booking itself is already saved; a calendar sync failure
    // shouldn't block the client's confirmation.
    console.error("Failed to add booking to Apple Calendar:", error);
  }

  return { ok: true };
}
