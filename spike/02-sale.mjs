// Day-1 spike, step 2: make a captured payment in the sandbox (a fake sale) with PayPal's published test card.
import { writeFileSync } from "node:fs";
import { pp, token } from "./lib.mjs";
const tok = await token();
const create = await pp("/v2/checkout/orders", {
  method: "POST", tok,
  headers: { "PayPal-Request-Id": `claimpack-spike-${Date.now()}` },
  body: {
    intent: "CAPTURE",
    purchase_units: [{ description: "ClaimPack spike: logo design", amount: { currency_code: "USD", value: "120.00" } }],
    payment_source: { card: { number: "4111111111111111", expiry: "2030-12", security_code: "123", name: "Test Buyer",
      billing_address: { address_line_1: "1 Test St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" } } },
  },
});
console.log("create order:", create.status, create.json?.status ?? "", create.json?.name ?? "", create.json?.details?.[0]?.issue ?? "");
if (create.status >= 300) { console.log(JSON.stringify(create.json).slice(0, 600)); process.exit(1); }
const cap = create.json.status === "COMPLETED" ? create.json : (await pp(`/v2/checkout/orders/${create.json.id}/capture`, { method: "POST", tok, body: "" })).json;
const c = cap.purchase_units?.[0]?.payments?.captures?.[0];
console.log("order:", cap.id, "| status:", cap.status, "| capture id:", c?.id, "| amount:", c?.amount?.value, c?.amount?.currency_code);
writeFileSync(new URL("./sale.json", import.meta.url), JSON.stringify({ order_id: cap.id, capture_id: c?.id, raw: cap }, null, 1));
