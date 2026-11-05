// Day-1 spike, step 3: open a dispute (sandbox-only API) as the buyer, then read it back as the seller.
import { readFileSync, writeFileSync } from "node:fs";
import { pp, token } from "./lib.mjs";
const f = new URL("./sale.json", import.meta.url);
const sale = JSON.parse(readFileSync(f, "utf8"));
const tok = await token();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
// The sandbox lets the app act for the BUYER through a signed-but-unsecured assertion: header.payload. (alg none)
const assertion = `${b64({ alg: "none" })}.${b64({ iss: process.env.PAYPAL_CLIENT_ID, email: sale.payer_email })}.`;
const res = await pp("/v1/customer/disputes", {
  method: "POST", tok, headers: { "PayPal-Auth-Assertion": assertion },
  body: {
    disputed_transactions: [{ seller_transaction_id: sale.capture_id }],
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    dispute_amount: { currency_code: "USD", value: "120.00" },
    extensions: { merchandise_dispute_properties: { issue_type: "SERVICE", service_details: { description: "Logo files never arrived", sub_reasons: ["NOT_AS_DESCRIBED"] } } },
  },
});
console.log("create dispute:", res.status);
console.log(JSON.stringify(res.json, null, 1).slice(0, 1500));
const id = res.json?.dispute_id || (typeof res.json === "object" && res.json?.links?.find?.((l) => l.rel === "self")?.href?.split("/").pop());
if (id) { writeFileSync(f, JSON.stringify({ ...sale, dispute_id: id }, null, 1)); console.log("dispute id:", id); }
