// Exports a proof bundle for one live sandbox filing: PayPal's own record of the dispute (read fresh from the API),
// the request ClaimPack sent, and a comparison of each file PayPal now holds against the SHA-256 ClaimPack logged.
// Buyer and seller emails are redacted. Usage: npx tsx scripts/proof.ts PP-R-XYA-10196950
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, PayPal } from "../src/paypal/client";
import { Store } from "../src/store";

const ROOT = join(import.meta.dirname, "..");
loadEnv(ROOT);
const id = process.argv[2];
if (!id) throw new Error("Give a dispute id.");
const store = new Store();
const pp = new PayPal();
const filing = store.filings(id).find((f) => f.status === 200);
if (!filing) throw new Error(`No successful filing logged for ${id}.`);

const ACCOUNT_KEYS = new Set(["payer_id", "merchant_id", "account_id", "approvedBy"]);
const redact = (v: unknown): unknown => JSON.parse(JSON.stringify(v), (k, x) => (ACCOUNT_KEYS.has(k) && typeof x === "string" ? "[redacted]" : typeof x === "string" ? x.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email redacted]") : x));
const dispute: any = await pp.getDispute(id);
const token = await pp.accessToken();
const held = (dispute.evidences ?? []).filter((e: any) => e.source === "SUBMITTED_BY_SELLER").flatMap((e: any) => e.documents ?? []);
const files = [];
for (const sent of filing.files as { name: string; bytes: number; sha256: string }[]) {
  const doc = held.find((d: any) => d.name === sent.name);
  let paypal: { bytes: number; sha256: string } | null = null;
  if (doc?.url) {
    const r = await fetch(doc.url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); paypal = { bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") }; }
  }
  files.push({ name: sent.name, sentBytes: sent.bytes, sentSha256: sent.sha256, paypalBytes: paypal?.bytes ?? null, paypalSha256: paypal?.sha256 ?? null, identical: paypal ? paypal.sha256 === sent.sha256 : null });
}

const dir = join(ROOT, "docs", "proof", `${filing.at.slice(0, 10)}-${id}`);
mkdirSync(dir, { recursive: true });
const strip = (d: any) => ({ ...d, links: undefined, evidences: (d.evidences ?? []).map((e: any) => ({ ...e, documents: (e.documents ?? []).map((x: any) => ({ name: x.name })) })) });
writeFileSync(join(dir, "paypal-dispute-now.json"), JSON.stringify(redact(strip(dispute)), null, 2));
writeFileSync(join(dir, "request-sent.json"), JSON.stringify(redact({ filedAt: filing.at, approvedBy: filing.approved_by, httpStatus: filing.status, input: filing.request }), null, 2));
writeFileSync(join(dir, "files.json"), JSON.stringify({ readAt: new Date().toISOString(), files }, null, 2));
console.log(JSON.stringify({ dir, status: dispute.status, stage: dispute.dispute_life_cycle_stage, files }, null, 1));
