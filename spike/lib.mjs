// Tiny shared helpers for the day-1 spike scripts. Never prints credentials or tokens.
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
export const base = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
export async function token() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  return (await r.json()).access_token;
}
export async function pp(path, { method = "GET", body, headers = {}, tok } = {}) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, debugId: r.headers.get("paypal-debug-id") };
}
