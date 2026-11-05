// Day-1 spike, step 4: as the SELLER, list disputes and (if one exists) show its stage, deadline and allowed actions.
import { pp, token } from "./lib.mjs";
const tok = await token();
const list = await pp("/v1/customer/disputes?page_size=10", { tok });
console.log("list disputes:", list.status, "| count:", list.json?.items?.length ?? 0);
for (const d of list.json?.items ?? []) console.log(" -", d.dispute_id, d.status, d.reason, d.dispute_amount?.value, d.create_time);
const id = process.argv[2] || list.json?.items?.[0]?.dispute_id;
if (id) {
  const g = await pp(`/v1/customer/disputes/${id}`, { tok });
  console.log("get dispute:", g.status, "| stage:", g.json.dispute_life_cycle_stage, "| status:", g.json.status, "| due:", g.json.seller_response_due_date);
  console.log("allowed actions:", (g.json.links ?? []).map((l) => l.rel).join(", "));
}
