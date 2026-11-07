// Checks that no secret from .env appears in any file git would publish, or anywhere in git history.
// Prints counts only, never the secrets. Usage: node scripts/secret-scan.mjs
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const SECRET = /^(PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_WEBHOOK_ID|META_API_KEY|NVIDIA_API_KEY|GLIMMER_API_KEY)=(.*)$/;
if (!existsSync(".env")) { console.log("No .env here: nothing to look for."); process.exit(0); }
const secrets = readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(SECRET)).filter(Boolean).map((m) => m[2].trim()).filter((v) => v.length >= 12);
const files = execSync("git ls-files -co --exclude-standard").toString().split("\n").filter(Boolean);
let hits = 0;
for (const f of files) {
  let t; try { t = readFileSync(f, "utf8"); } catch { continue; }
  for (const s of secrets) if (t.includes(s)) { console.log(`secret found in ${f}`); hits++; }
}
const history = execSync("git log -p --all", { maxBuffer: 512 * 1024 * 1024 }).toString();
for (const s of secrets) if (history.includes(s)) { console.log("secret found in git history"); hits++; }
console.log(`secrets checked: ${secrets.length}; files: ${files.length}; found: ${hits}`);
process.exit(hits ? 1 : 0);
