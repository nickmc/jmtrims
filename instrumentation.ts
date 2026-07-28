// Runs once when the Next.js server process starts (see
// https://nextjs.org/docs/app/guides/instrumentation). Used to poll Apple
// Calendar for bookings the owner has deleted — see lib/cancellations.ts for
// why this has to be a poll rather than a webhook.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { checkForCancellations } = await import("./lib/cancellations");

  const POLL_INTERVAL_MS = 5 * 60_000;

  setInterval(() => {
    checkForCancellations().catch((error) => {
      console.error("Cancellation poll failed:", error);
    });
  }, POLL_INTERVAL_MS);
}
