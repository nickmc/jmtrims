import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function writeAndReadTestRow() {
  const value = `ping-${Date.now()}`;

  db.prepare("INSERT INTO connection_test (value) VALUES (?)").run(value);

  const row = db
    .prepare(
      "SELECT value, created_at FROM connection_test ORDER BY id DESC LIMIT 1"
    )
    .get() as { value: string; created_at: string } | undefined;

  return { value, row };
}

export default function DbTestPage() {
  const { value, row } = writeAndReadTestRow();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-2xl">SQLite write/read test passed</p>
      <p className="text-lg">
        wrote: <code>{value}</code>
      </p>
      <p className="text-lg">
        read back: <code>{row?.value}</code> at <code>{row?.created_at}</code>
      </p>
    </div>
  );
}
