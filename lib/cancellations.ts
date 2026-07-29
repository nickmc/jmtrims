import { db } from "@/lib/db";
import { findDeletedCalendarObjectUrls } from "@/lib/calendar";

// Apple/iCloud has no webhook for third-party CalDAV clients, so the only
// way to notice the owner deleted a booking in Apple Calendar is to poll:
// check whether each active booking's calendar event still exists.
//
// A booking is only cancelled once its event is missing on two separate
// polls in a row (calendar_missing_since gets set on the first, and only
// leads to cancelling on a later poll where it's still unset-then-missing
// again). A one-off blip — a network hiccup, or briefly resolving to the
// wrong calendar (the exact bug this two-strike check was added to guard
// against) — clears itself on the next poll instead of silently freeing a
// slot that's still genuinely booked.
export async function checkForCancellations(): Promise<void> {
  const active = db
    .prepare(
      `SELECT id, calendar_object_url, calendar_missing_since FROM appointments
       WHERE cancelled_at IS NULL AND calendar_object_url IS NOT NULL`
    )
    .all() as {
    id: number;
    calendar_object_url: string;
    calendar_missing_since: string | null;
  }[];

  if (active.length === 0) return;

  const urls = active.map((row) => row.calendar_object_url);
  const missingUrls = await findDeletedCalendarObjectUrls(urls);
  if (!missingUrls) return;

  const missingUrlSet = new Set(missingUrls);

  const markMissing = db.prepare(
    "UPDATE appointments SET calendar_missing_since = datetime('now') WHERE id = ?"
  );
  const clearMissing = db.prepare(
    "UPDATE appointments SET calendar_missing_since = NULL WHERE id = ?"
  );
  const cancel = db.prepare(
    "UPDATE appointments SET cancelled_at = datetime('now') WHERE id = ?"
  );

  for (const row of active) {
    const isMissing = missingUrlSet.has(row.calendar_object_url);

    if (!isMissing) {
      if (row.calendar_missing_since !== null) {
        clearMissing.run(row.id);
      }
      continue;
    }

    if (row.calendar_missing_since === null) {
      markMissing.run(row.id);
    } else {
      cancel.run(row.id);
    }
  }
}
