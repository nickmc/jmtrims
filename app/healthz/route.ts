import { db } from "@/lib/db";

// Hatchbox's health check URI and the Docker healthcheck both hit this.
// Never cached — a cached 200 would mask a broken container.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Touch the database so an unwritable volume or failed migration surfaces
    // as an unhealthy container rather than a page that 500s later.
    const row = db.prepare("PRAGMA user_version").get() as
      | { user_version: number }
      | undefined;

    return Response.json({
      status: "ok",
      schemaVersion: row?.user_version ?? 0,
      buildTime: process.env.JMTRIMS_BUILD_TIME || null,
    });
  } catch (error) {
    return Response.json(
      { status: "error", error: String(error) },
      { status: 503 }
    );
  }
}
