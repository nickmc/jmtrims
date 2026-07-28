"use server";

import { db } from "@/lib/db";
import { isOpenDay, isPastSlot, slotsForDay } from "@/lib/booking";
import { addBookingToCalendar } from "@/lib/calendar";
import type { StatementResultingChanges } from "node:sqlite";

export type SlotAvailability = { time: string; available: boolean };

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

  const slots = slotsForDay().map((time) => ({
    time,
    available: !bookedTimes.has(time) && !isPastSlot(date, time),
  }));

  return { open: true, slots };
}

export type BookingInput = {
  date: string;
  time: string;
  name: string;
  phone: string;
  location: string;
};

export type BookingResult = { ok: true } | { ok: false; error: string };

export async function createBooking(
  input: BookingInput
): Promise<BookingResult> {
  const { date, time, name, phone, location } = input;

  if (!isOpenDay(date)) {
    return { ok: false, error: "That day isn't available for bookings." };
  }
  if (!slotsForDay().includes(time)) {
    return { ok: false, error: "That time slot isn't valid." };
  }
  if (isPastSlot(date, time)) {
    return { ok: false, error: "That time has already passed." };
  }
  if (!name.trim() || !phone.trim() || !location.trim()) {
    return { ok: false, error: "Name, phone, and location are all required." };
  }

  const startsAt = `${date}T${time}`;
  let changes: StatementResultingChanges;

  try {
    changes = db
      .prepare(
        "INSERT INTO appointments (name, phone, location, starts_at) VALUES (?, ?, ?, ?)"
      )
      .run(name.trim(), phone.trim(), location.trim(), startsAt);
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
