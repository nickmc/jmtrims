import { createDAVClient, type DAVCalendar } from "tsdav";
import { SLOT_MINUTES, slotStartUtc } from "@/lib/booking";

type DAVClient = Awaited<ReturnType<typeof createDAVClient>>;

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

// Both the booking write and the cancellation poller need the same "which
// calendar do we write to" resolution, and both should quietly no-op if the
// Apple credentials aren't configured — this is where that's decided.
async function connect(): Promise<{
  client: DAVClient;
  calendar: DAVCalendar;
} | null> {
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
    calendars.find((cal) => cal.components?.includes("VEVENT")) ??
    calendars[0];

  if (!calendar) {
    throw new Error("No writable Apple Calendar found");
  }

  return { client, calendar };
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
  const connection = await connect();
  if (!connection) return null;
  const { client, calendar } = connection;

  const uid = `${crypto.randomUUID()}@jmtrims.com`;
  const filename = `${uid}.ics`;
  const start = slotStartUtc(input.date, input.time);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);

  await client.createCalendarObject({
    calendar,
    iCalString: buildEventIcs(input, uid, new Date()),
    filename,
  });

  // iCloud doesn't reliably honour the URL implied by the filename we PUT to
  // (it can percent-encode characters like "@" differently in the hrefs it
  // hands back later), so rather than predicting the URL, look up what the
  // server actually assigned by searching around the event's own time range.
  const created = await client.fetchCalendarObjects({
    calendar,
    timeRange: {
      start: new Date(start.getTime() - 60_000).toISOString(),
      end: new Date(end.getTime() + 60_000).toISOString(),
    },
  });

  const match = created.find((obj) => obj.data.includes(`UID:${uid}`));
  return match?.url ?? null;
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

  const connection = await connect();
  if (!connection) return null;
  const { client, calendar } = connection;

  // Wide enough to cover any real booking — the day-chip picker only offers
  // a couple of weeks out, but the native date field allows further ahead.
  const now = Date.now();
  const start = new Date(now - 24 * 60 * 60_000).toISOString();
  const end = new Date(now + 400 * 24 * 60 * 60_000).toISOString();

  const existing = await client.fetchCalendarObjects({
    calendar,
    timeRange: { start, end },
  });

  const existingUrls = new Set(existing.map((obj) => obj.url));
  return urls.filter((url) => !existingUrls.has(url));
}
