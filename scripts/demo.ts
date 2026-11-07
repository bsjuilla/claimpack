// npm run demo: ClaimPack with no PayPal account and no Meta key.
// Starts from a fresh data-demo/ folder each time, loads the 30 published evaluation disputes with the readings
// Muse Spark returned for them, and files to a simulated PayPal. Your real data/ folder and .env are not touched.
import { rmSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "data-demo");
rmSync(dir, { recursive: true, force: true });
process.env.CLAIMPACK_DEMO = "1";
process.env.CLAIMPACK_DATA = dir;
process.env.CLAIMPACK_POLL_SECONDS = "0";
await import("../server/index");
