import { createDAVClient, type DAVCalendar } from "tsdav";
import { SLOT_MINUTES, slotStartUtc } from "@/lib/booking";

type DAVClient = Awaited<ReturnType<typeof createDAVClient>>;
type Connection = { client: DAVClient; calendar: DAVCalendar };

export type BookingCalendarInput = {
  name: string;
  phone: string;
  location: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, in the shop's local time (see lib/booking.ts)
};

function formatUtc(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

function buildEventIcs(
  input: BookingCalendarInput,
  uid: string,
  now: Date
): string {
  const start = slotStartUtc(input.date, input.time);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JM Trims//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeIcsText(`Haircut - ${input.name}`)}`,
    `LOCATION:${escapeIcsText(input.location)}`,
    `DESCRIPTION:${escapeIcsText(`Phone: ${input.phone}`)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:New booking",
    `TRIGGER;VALUE=DATE-TIME:${formatUtc(now)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// Which calendar to read/write, by display name — NOT by picking "whichever
// comes first" from fetchCalendars(). iCloud does not guarantee that list is
// in a stable order across requests, so a position-based pick can silently
// resolve to a different calendar on a later call. That's a real incident
// this app already hit: a booking's event landed in "Barbering", but the
// cancellation poller's own connect() call later picked a different calendar,
// didn't find the event there, concluded it had been deleted, and wrongly
// freed the slot. Selecting by name is deterministic regardless of API order.
const CALENDAR_NAME = process.env.APPLE_CALENDAR_NAME || "Barbering";

async function establishConnection(): Promise<Connection | null> {
  const username = process.env.APPLE_CALDAV_USERNAME;
  const password = process.env.APPLE_CALDAV_APP_PASSWORD;

  if (!username || !password) {
    return null;
  }

  const client = await createDAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  const calendars = await client.fetchCalendars();
  const calendar =
    calendars.find(
      (cal) => cal.displayName === CALENDAR_NAME && cal.components?.includes("VEVENT")
    ) ??
    calendars.find((cal) => cal.components?.includes("VEVENT")) ??
    calendars[0];

  if (!calendar) {
    throw new Error("No writable Apple Calendar found");
  }

  return { client, calendar };
}

// Reuses one CalDAV connection across calls instead of repeating Apple's full
// service-discovery handshake (principal lookup, calendar-home-set, calendar
// list) on every single request. That discovery was adding several
// sequential round-trips to iCloud on every date a customer clicked — the
// actual cause of the booking calendar feeling sluggish, not just the one
// unavoidable "fetch this date's events" request. If a cached connection's
// own call fails (e.g. the session went stale), the caller invalidates it so
// the next request re-establishes fresh rather than staying broken.
let cachedConnection: Connection | null = null;
let pendingConnection: Promise<Connection | null> | null = null;

async function connect(): Promise<Connection | null> {
  if (cachedConnection) return cachedConnection;
  if (pendingConnection) return pendingConnection;

  pendingConnection = establishConnection();
  try {
    cachedConnection = await pendingConnection;
    return cachedConnection;
  } finally {
    pendingConnection = null;
  }
}

function invalidateConnection(): void {
  cachedConnection = null;
}

async function withConnection<T>(
  fn: (connection: Connection) => Promise<T>
): Promise<T | null> {
  const connection = await connect();
  if (!connection) return null;

  try {
    return await fn(connection);
  } catch (error) {
    invalidateConnection();
    throw error;
  }
}

// Adds a booking to the shop owner's Apple Calendar via CalDAV, so a real
// event with an immediate notification shows up as soon as someone books.
// Returns the created event's URL (to store against the booking, so a later
// poll can tell whether it's been deleted) or null if Apple credentials
// aren't configured — the booking itself (in SQLite) is the source of truth
// and shouldn't depend on this succeeding.
export async function addBookingToCalendar(
  input: BookingCalendarInput
): Promise<string | null> {
  return withConnection(async ({ client, calendar }) => {
    const uid = `${crypto.randomUUID()}@jmtrims.com`;
    const filename = `${uid}.ics`;
    const start = slotStartUtc(input.date, input.time);
    const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);

    await client.createCalendarObject({
      calendar,
      iCalString: buildEventIcs(input, uid, new Date()),
      filename,
    });

    // iCloud doesn't reliably honour the URL implied by the filename we PUT
    // to (it can percent-encode characters like "@" differently in the
    // hrefs it hands back later), so rather than predicting the URL, look up
    // what the server actually assigned by searching around the event's own
    // time range.
    const created = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        start: new Date(start.getTime() - 60_000).toISOString(),
        end: new Date(end.getTime() + 60_000).toISOString(),
      },
    });

    const match = created.find((obj) => obj.data.includes(`UID:${uid}`));
    return match?.url ?? null;
  });
}

// Given the object URLs of previously-created booking events, returns the
// ones that no longer exist on the calendar — i.e. the owner deleted them in
// Apple Calendar. Returns null if Apple credentials aren't configured, so the
// poller can skip the check entirely rather than treating everything as
// cancelled.
//
// This has to fetch a time range and diff URLs rather than ask for the exact
// object URLs directly (CalDAV multiget): iCloud's multiget throws for the
// whole request if even one of the requested hrefs is missing, which is
// exactly the case here (we're checking for the ones that got deleted).
export async function findDeletedCalendarObjectUrls(
  urls: string[]
): Promise<string[] | null> {
  if (urls.length === 0) return [];

  return withConnection(async ({ client, calendar }) => {
    // Wide enough to cover any real booking — the day-chip picker only
    // offers a couple of weeks out, but the native date field allows
    // further ahead.
    const now = Date.now();
    const start = new Date(now - 24 * 60 * 60_000).toISOString();
    const end = new Date(now + 400 * 24 * 60 * 60_000).toISOString();

    const existing = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start, end },
    });

    const existingUrls = new Set(existing.map((obj) => obj.url));
    return urls.filter((url) => !existingUrls.has(url));
  });
}

export type BusyPeriod = { start: Date; end: Date };

// All bookings this app creates carry this UID suffix (see addBookingToCalendar).
// A manually-added event in Apple Calendar will never happen to contain it, so
// it's a safe way to tell "the owner's own busy time" apart from "a client's
// booking" without needing a separate marker property.
const OWN_BOOKING_MARKER = "@jmtrims.com";

function parseEventTime(
  data: string,
  field: "DTSTART" | "DTEND"
): { date: Date; allDay: boolean } | null {
  const match = data.match(new RegExp(`${field}(;[^:\\r\\n]*)?:([^\\r\\n]+)`));
  if (!match) return null;

  const params = match[1] ?? "";
  const value = match[2].trim();
  const allDay = params.includes("VALUE=DATE") && !params.includes("VALUE=DATE-TIME");

  const y = value.slice(0, 4);
  const mo = value.slice(4, 6);
  const d = value.slice(6, 8);

  if (allDay) {
    return { date: new Date(`${y}-${mo}-${d}T00:00:00Z`), allDay: true };
  }

  const h = value.slice(9, 11) || "00";
  const mi = value.slice(11, 13) || "00";
  const s = value.slice(13, 15) || "00";
  return { date: new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`), allDay: false };
}

// Short-lived cache of each date's busy periods — the booking calendar polls
// getAvailability every 60s per open tab (see BookingCalendar.tsx's
// refreshTick) and re-fetches on every date the customer clicks, so without
// this a moment of Browse-back-and-forth re-hits iCloud for the same day
// repeatedly. 20s is short enough that a real change (the owner just added a
// busy event) shows up on the very next tick or click almost always, while
// still absorbing rapid repeat calls.
const BUSY_PERIODS_CACHE_MS = 20_000;
const busyPeriodsCache = new Map<
  string,
  { expiresAt: number; value: BusyPeriod[] | null }
>();

// Returns the time periods on `date` where the owner has manually blocked
// themselves out in Apple Calendar (a day off, an appointment elsewhere,
// etc.) — anything in the calendar that ISN'T one of this app's own booking
// events. Returns null if Apple credentials aren't configured.
export async function getBusyPeriods(date: string): Promise<BusyPeriod[] | null> {
  const cached = busyPeriodsCache.get(date);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await withConnection(async ({ client, calendar }) => {
    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const events = await client.fetchCalendarObjects({
      calendar,
      timeRange: {
        // A day's worth of buffer either side covers all-day events and any
        // timezone slop, since we filter by real overlap below anyway.
        start: new Date(dayStart.getTime() - 24 * 60 * 60_000).toISOString(),
        end: new Date(dayEnd.getTime() + 24 * 60 * 60_000).toISOString(),
      },
    });

    const busy: BusyPeriod[] = [];

    for (const event of events) {
      if (event.data.includes(OWN_BOOKING_MARKER)) continue;

      const start = parseEventTime(event.data, "DTSTART");
      if (!start) continue;

      const end = parseEventTime(event.data, "DTEND");
      const endDate = end
        ? end.date
        : new Date(
            start.date.getTime() + (start.allDay ? 24 * 60 * 60_000 : 60 * 60_000)
          );

      if (endDate <= dayStart || start.date >= dayEnd) continue;

      busy.push({ start: start.date, end: endDate });
    }

    return busy;
  });

  busyPeriodsCache.set(date, { expiresAt: Date.now() + BUSY_PERIODS_CACHE_MS, value });
  return value;
}
