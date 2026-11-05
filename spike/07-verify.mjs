import { pp, token } from "./lib.mjs";
const tok = await token();
const g = await pp(`/v1/customer/disputes/${process.argv[2]}`, { tok });
const d = g.json;
console.log("status:", d.status, "| stage:", d.dispute_life_cycle_stage, "| reason:", d.reason);
console.log("evidences filed:", (d.evidences ?? []).length);
for (const e of d.evidences ?? []) console.log(" -", e.evidence_type, "| source:", e.source, "| notes:", e.notes, "| docs:", (e.documents ?? []).map((x) => x.name).join(","), "| tracking:", JSON.stringify(e.evidence_info?.tracking_info ?? []).slice(0, 160));
console.log("allowed actions now:", (d.links ?? []).map((l) => l.rel).join(", "));
