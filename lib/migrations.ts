import type { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order on startup.
 *
 * To add one: append an entry to this array. Never edit or reorder an entry
 * that has already shipped — servers track how many have run via SQLite's
 * `user_version` pragma, so changing history silently skips the change on any
 * database that is already past it. Fixes go in a new migration.
 *
 * Each `up` runs inside a transaction; a throw rolls that migration back and
 * aborts startup, so a broken deploy fails loudly instead of half-migrating.
 */
export type Migration = {
  name: string;
  up: (db: DatabaseSync) => void;
};

export const migrations: Migration[] = [
  {
    name: "create_connection_test",
    up: (db) => {
      db.exec(`
        CREATE TABLE connection_test (
          id         INTEGER PRIMARY KEY,
          value      TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    name: "create_appointments",
    up: (db) => {
      db.exec(`
        CREATE TABLE appointments (
          id         INTEGER PRIMARY KEY,
          name       TEXT NOT NULL,
          phone      TEXT NOT NULL,
          location   TEXT NOT NULL,
          starts_at  TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    name: "add_calendar_sync_to_appointments",
    up: (db) => {
      // calendar_object_url identifies the CalDAV event created for this
      // booking, so a poller can notice when the owner deletes it in Apple
      // Calendar. cancelled_at is set (rather than deleting the row) so the
      // client's name/phone/location are still around to follow up with,
      // while the slot itself frees up for new bookings.
      db.exec(`ALTER TABLE appointments ADD COLUMN calendar_object_url TEXT`);
      db.exec(`ALTER TABLE appointments ADD COLUMN cancelled_at TEXT`);
      // Unique only among active bookings, so a cancelled slot's starts_at
      // can be booked again by someone else.
      db.exec(`
        CREATE UNIQUE INDEX idx_appointments_active_starts_at
          ON appointments(starts_at)
          WHERE cancelled_at IS NULL
      `);
    },
  },
];

/**
 * Bring `db` up to the latest schema version. Idempotent: migrations already
 * recorded in `user_version` are skipped, so this is safe to call on every boot.
 */
export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  const current = row?.user_version ?? 0;

  if (current > migrations.length) {
    throw new Error(
      `Database schema version ${current} is newer than this build knows about ` +
        `(${migrations.length} migrations). Deploy the matching or newer code.`
    );
  }

  for (let version = current; version < migrations.length; version++) {
    const migration = migrations[version];
    db.exec("BEGIN");
    try {
      migration.up(db);
      // user_version does not accept a bound parameter, hence the interpolation.
      // `version` is a loop index over a hardcoded array, so it is never user input.
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migration ${version + 1} (${migration.name}) failed: ${String(error)}`
      );
    }
  }
}
