// Open Sunday through Saturday except Wednesday. Date.getDay(): Sun=0 ... Sat=6.
const OPEN_WEEKDAYS = new Set([0, 1, 2, 4, 5, 6]);

const OPEN_HOUR = 9;
const CLOSE_HOUR = 19;
export const SLOT_MINUTES = 45;

// The shop's own timezone — "9:00" always means 9am in the UK, whether that's
// GMT or BST. Slot times are quoted and stored as this local wall-clock time;
// this is the one place that converts to a real, DST-aware UTC instant.
const SHOP_TIMEZONE = "Europe/London";

function shopOffsetMinutesAt(utcGuess: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHOP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcGuess);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );

  return (asUtc - utcGuess.getTime()) / 60_000;
}

// Converts a shop-local wall-clock date+time (e.g. "2026-07-28", "09:00") to
// the actual UTC instant it refers to, accounting for GMT/BST.
export function slotStartUtc(date: string, time: string): Date {
  const naiveUtc = new Date(`${date}T${time}:00Z`);
  const offsetMinutes = shopOffsetMinutesAt(naiveUtc);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

export function isOpenDay(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return OPEN_WEEKDAYS.has(day);
}

export function isPastSlot(date: string, time: string): boolean {
  return slotStartUtc(date, time).getTime() <= Date.now();
}

// UK phone numbers: 11 digits starting with 0 (07123 456789, 01234 567890),
// or the same number with 0 replaced by +44. Spaces/dashes/brackets are
// ignored so customers can type it however feels natural.
export function isValidPhoneNumber(raw: string): boolean {
  const cleaned = raw.replace(/[\s().-]/g, "");
  return /^0\d{10}$/.test(cleaned) || /^\+44\d{10}$/.test(cleaned);
}

export function slotsForDay(): string[] {
  const slots: string[] = [];
  const closeMinutes = CLOSE_HOUR * 60;

  for (
    let minutes = OPEN_HOUR * 60;
    minutes + SLOT_MINUTES <= closeMinutes;
    minutes += SLOT_MINUTES
  ) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    slots.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
  }

  return slots;
}
