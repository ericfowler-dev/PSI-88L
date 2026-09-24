import { processNextJob } from "../backend/worker.ts";
import { closeDatabase } from "../backend/db.ts";
if (!process.env.DATABASE_URL)
  throw new Error(
    "A separate worker requires DATABASE_URL. Local PGlite uses the embedded worker.",
  );
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  try {
    if (!(await processNextJob())) await new Promise((resolve) => setTimeout(resolve, 1500));
  } catch {
    console.error("[worker] Job loop failed; retrying.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
await closeDatabase();
