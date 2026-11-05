// Day-1 spike, step 6 (THE GATE): file seller evidence through the Disputes API (multipart: JSON input + a document).
import { base, token } from "./lib.mjs";
const id = process.argv[2];
const tok = await token();
const input = { evidences: [{
  evidence_type: "OTHER",
  evidence_info: {},
  documents: [{ name: "delivery-log.txt" }],
  notes: "Logo files were delivered on 5 Nov 2026 via download link; delivery log attached.",
}] };
const fd = new FormData();
fd.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
fd.append("file1", new Blob(["2026-11-05 16:05 UTC  download link sent to buyer\n2026-11-05 16:07 UTC  buyer opened link (2 downloads)\n"], { type: "text/plain" }), "delivery-log.txt");
const r = await fetch(`${base}/v1/customer/disputes/${id}/provide-evidence`, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: fd });
const t = await r.text();
console.log("provide-evidence:", r.status, "| debug:", r.headers.get("paypal-debug-id"));
console.log(t.slice(0, 700));
