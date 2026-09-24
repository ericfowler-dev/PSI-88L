import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// The pilot must never start successfully on Render's ephemeral filesystem.
const mount = "/var/data";
const data = resolve(process.env.DATA_DIR || "");
if (process.platform !== "linux" || !data.startsWith(mount + sep)) {
  throw new Error("The disk deployment requires DATA_DIR under /var/data on Linux.");
}
const mounts = await readFile("/proc/self/mountinfo", "utf8");
if (!mounts.split("\n").some((line) => line.split(" ")[4] === mount)) {
  throw new Error("Persistent /var/data mount is missing. Refusing ephemeral storage.");
}
if ((process.env.APP_SECRET || "").length < 32 || !process.env.SETUP_TOKEN) {
  throw new Error("APP_SECRET and SETUP_TOKEN must be configured before startup.");
}
await import("../.output/server/index.mjs");
