// Day-1 spike, step 2b: create an order the sandbox BUYER must approve in PayPal's own login, then capture it.
// Usage: node spike/02b-order-wallet.mjs            -> creates the order and prints the approval link
//        node spike/02b-order-wallet.mjs capture    -> captures it once the buyer has approved
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { pp, token } from "./lib.mjs";
const f = new URL("./sale.json", import.meta.url);
const tok = await token();
if (process.argv[2] !== "capture") {
  const create = await pp("/v2/checkout/orders", {
    method: "POST", tok, headers: { "PayPal-Request-Id": `claimpack-spike-${Date.now()}` },
    body: { intent: "CAPTURE",
      purchase_units: [{ description: "ClaimPack spike: logo design (digital delivery)", amount: { currency_code: "USD", value: "120.00" } }],
      payment_source: { paypal: { experience_context: { payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", user_action: "PAY_NOW",
        return_url: "https://example.com/return", cancel_url: "https://example.com/cancel" } } } },
  });
  console.log("create order:", create.status, create.json?.status ?? create.json?.name);
  if (create.status >= 300) { console.log(JSON.stringify(create.json).slice(0, 500)); process.exit(1); }
  const link = create.json.links.find((l) => ["payer-action", "approve"].includes(l.rel))?.href;
  writeFileSync(f, JSON.stringify({ order_id: create.json.id }, null, 1));
  console.log("order id:", create.json.id);
  console.log("BUYER APPROVAL LINK:\n" + link);
} else {
  const { order_id } = JSON.parse(readFileSync(f, "utf8"));
  const cap = await pp(`/v2/checkout/orders/${order_id}/capture`, { method: "POST", tok, body: "" });
  const c = cap.json.purchase_units?.[0]?.payments?.captures?.[0];
  console.log("capture:", cap.status, cap.json.status ?? cap.json.name, cap.json.details?.[0]?.issue ?? "");
  console.log("capture id:", c?.id, "| amount:", c?.amount?.value, c?.amount?.currency_code, "| payer:", cap.json.payer?.email_address);
  writeFileSync(f, JSON.stringify({ order_id, capture_id: c?.id, payer_id: cap.json.payer?.payer_id, payer_email: cap.json.payer?.email_address, raw: cap.json }, null, 1));
}
