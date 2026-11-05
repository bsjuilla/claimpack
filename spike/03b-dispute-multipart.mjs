// Same as 03, but in the multipart format PayPal's test guide shows (input part = JSON).
import { readFileSync, writeFileSync } from "node:fs";
import { base, token } from "./lib.mjs";
const f = new URL("./sale.json", import.meta.url);
const sale = JSON.parse(readFileSync(f, "utf8"));
const tok = await token();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const assertion = `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: process.env.PAYPAL_CLIENT_ID, email: sale.payer_email })}.`;
const input = { disputed_transactions: [{ seller_transaction_id: sale.capture_id }], reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  dispute_amount: { currency_code: "USD", value: "120.00" },
  extensions: { merchant_contacted: true, merchant_contacted_outcome: "NO_RESPONSE", merchandize_dispute_properties: { issue_type: "SERVICE", service_details: { sub_reasons: ["INCOMPLETE"] } } } };
const fd = new FormData();
fd.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
const r = await fetch(`${base}/v1/customer/disputes`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "PayPal-Auth-Assertion": assertion }, body: fd });
const t = await r.text();
console.log("create dispute (multipart):", r.status);
console.log(t.slice(0, 900));
try { const j = JSON.parse(t); if (j.links) { const id = j.links.find((l) => l.rel === "self")?.href.split("/").pop(); writeFileSync(f, JSON.stringify({ ...sale, dispute_id: id }, null, 1)); console.log("dispute id:", id); } } catch {}
