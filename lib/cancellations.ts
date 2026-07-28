import { db } from "@/lib/db";
import { findDeletedCalendarObjectUrls } from "@/lib/calendar";

// Apple/iCloud has no webhook for third-party CalDAV clients, so the only
// way to notice the owner deleted a booking in Apple Calendar is to poll:
// check whether each active booking's calendar event still exists, and if
// not, mark it cancelled (freeing the slot) so the owner can follow up with
// the client directly using the name/phone/location still on the row.
export async function checkForCancellations(): Promise<void> {
  const active = db
    .prepare(
      `SELECT id, calendar_object_url FROM appointments
       WHERE cancelled_at IS NULL AND calendar_object_url IS NOT NULL`
    )
    .all() as { id: number; calendar_object_url: string }[];

  if (active.length === 0) return;

  const urls = active.map((row) => row.calendar_object_url);
  const deletedUrls = await findDeletedCalendarObjectUrls(urls);
  if (!deletedUrls || deletedUrls.length === 0) return;

  const deletedUrlSet = new Set(deletedUrls);
  const cancel = db.prepare(
    "UPDATE appointments SET cancelled_at = datetime('now') WHERE id = ?"
  );

  for (const row of active) {
    if (deletedUrlSet.has(row.calendar_object_url)) {
      cancel.run(row.id);
    }
  }
}
