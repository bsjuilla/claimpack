// Day-1 spike, step 5: sandbox-only, move the dispute to "waiting for seller", then show what the seller can now do.
import { pp, token } from "./lib.mjs";
const id = process.argv[2];
const tok = await token();
const r = await pp(`/v1/customer/disputes/${id}/require-evidence`, { method: "POST", tok, body: { action: "SELLER_EVIDENCE" } });
console.log("require-evidence:", r.status, typeof r.json === "object" ? JSON.stringify(r.json).slice(0, 400) : r.json);
await new Promise((ok) => setTimeout(ok, 4000));
const g = await pp(`/v1/customer/disputes/${id}`, { tok });
console.log("get dispute:", g.status, "| stage:", g.json.dispute_life_cycle_stage, "| status:", g.json.status, "| seller response due:", g.json.seller_response_due_date);
console.log("allowed actions:", (g.json.links ?? []).map((l) => l.rel).join(", "));
console.log("offer/evidence types hint:", JSON.stringify(g.json.allowed_response_options ?? {}).slice(0, 500));
