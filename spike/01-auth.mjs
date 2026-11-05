// Day-1 spike, step 1: do the sandbox keys work, and what can this app do?
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const base = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");

const r = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
const j = await r.json().catch(() => ({}));
console.log("token request:", r.status, r.statusText);
if (!r.ok) { console.log("error:", j.error, j.error_description); process.exit(1); }
console.log("token type:", j.token_type, "| expires in (s):", j.expires_in);
console.log("app id:", j.app_id);
console.log("scopes granted:");
for (const s of String(j.scope).split(" ")) console.log("  ", s.replace("https://uri.paypal.com/services/", ""));
