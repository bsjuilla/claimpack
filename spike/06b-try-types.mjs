// Tries evidence categories until PayPal accepts one (stops at the first success so evidence is filed once).
import { base, token } from "./lib.mjs";
const id = process.argv[2];
const tok = await token();
const notes = "Logo files were delivered on 5 Nov 2026 via download link; delivery log attached.";
const candidates = [
  { evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "OTHER", carrier_name_other: "Digital download", tracking_number: "DL-20261105-0001" }] } },
  { evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: {} },
  { evidence_type: "PROOF_OF_DELIVERY_SIGNATURE", evidence_info: {} },
  { evidence_type: "PROOF_OF_RECEIPT_COPY", evidence_info: {} },
  { evidence_type: "ITEM_DESCRIPTION", evidence_info: {} },
];
for (const c of candidates) {
  const input = { evidences: [{ ...c, documents: [{ name: "delivery-log.txt" }], notes }] };
  const fd = new FormData();
  fd.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  fd.append("file1", new Blob(["2026-11-05 16:05 UTC  download link sent to buyer\n2026-11-05 16:07 UTC  buyer opened link (2 downloads)\n"], { type: "text/plain" }), "delivery-log.txt");
  const r = await fetch(`${base}/v1/customer/disputes/${id}/provide-evidence`, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: fd });
  const t = await r.text();
  let issue = ""; try { issue = JSON.parse(t).details?.map((d) => d.issue + (d.field ? ` (${d.field})` : "")).join(", "); } catch {}
  console.log(`${c.evidence_type}${c.evidence_info.tracking_info ? " +tracking" : ""} -> ${r.status} ${issue || t.slice(0, 200)}`);
  if (r.status < 300) break;
}
