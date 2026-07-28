import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "./migrations";

// All persistent state lives under JMTRIMS_DATA_DIR, which in production is the
// host volume bind-mounted at /data (see docker-compose.yml). Locally it
// defaults to ./_data, which is git-ignored.
const dataDir = process.env.JMTRIMS_DATA_DIR ?? path.join(process.cwd(), "_data");

// Overridable mainly so tests can point at a scratch file or ":memory:".
const dbPath = process.env.JMTRIMS_DB ?? path.join(dataDir, "jmtrims.sqlite3");

function open(): DatabaseSync {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const database = new DatabaseSync(dbPath);

  // WAL lets reads proceed during a write — worth having as soon as the booking
  // flow does anything concurrent. Not supported for in-memory databases.
  if (dbPath !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL");
  }
  // Wait rather than throwing immediately when another connection holds a write
  // lock, and enforce foreign keys (SQLite leaves them off by default).
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");

  migrate(database);
  return database;
}

// Next dev server hot-reloads modules, which would otherwise open a new handle
// on every reload and exhaust the WAL locks. Cache the connection on globalThis
// so a reload reuses it.
const globalForDb = globalThis as typeof globalThis & {
  __jmtrimsDb?: DatabaseSync;
};

// `next build` imports every route's modules (including this one) from
// several parallel workers just to collect their config — not to serve real
// requests. Actually opening + migrating the file there means multiple
// worker processes race to write-migrate the same fresh SQLite file, which
// intermittently fails with "database is locked". Nothing at build time
// needs a real connection, so skip it entirely in that phase.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function unavailableDuringBuild(): DatabaseSync {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `lib/db.ts: attempted to use db.${String(prop)} during next build — ` +
            "the database is only available at runtime."
        );
      },
    }
  ) as DatabaseSync;
}

export const db: DatabaseSync = isBuildPhase
  ? unavailableDuringBuild()
  : (globalForDb.__jmtrimsDb ?? open());

if (!isBuildPhase && process.env.NODE_ENV !== "production") {
  globalForDb.__jmtrimsDb = db;
}

export { dbPath };
