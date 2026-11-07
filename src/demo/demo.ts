// Demo mode: run ClaimPack with no PayPal account and no Meta key.
// It loads the 30 published evaluation disputes, their documents and the readings Muse Spark returned for them
// (eval/runs/<run>/reads), and answers PayPal calls from a small in-memory stand-in. Filing goes to that stand-in,
// which checks the request the way PayPal's API does (file names, formats, sizes) and records it. Nothing leaves
// the computer. The clock is set to the evaluation date so every deadline reads as it did when the set was scored.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { toFacts } from "../ai/reader";
import { PAYPAL_DOC_NAME } from "../paypal/evidence";
import { ALLOWED_MIME, MAX_CALL_BYTES, MAX_FILE_BYTES } from "../rules/paypalRules";
import { textToPdf } from "../pdf/pdfs";
import type { VerifiedRefund } from "../rules/engine";
import type { Store } from "../store";
import type { DisputeCase } from "../types";

export const DEMO_RUN = "published-2026-11-07-v2";
export const DEMO_NOW = "2026-11-07T12:00:00Z";
const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg" };

interface EvalCase { id: string; title: string; dispute: DisputeCase; refunds: VerifiedRefund[]; docs: { name: string }[] }

/** PayPal's dispute JSON, rebuilt from the evaluation's normalised case (the inverse of toDisputeCase). */
export function rawDispute(d: DisputeCase, title: string) {
  return {
    dispute_id: d.id, reason: d.reason, status: d.status, dispute_life_cycle_stage: d.stage, dispute_channel: d.channel ?? "INTERNAL",
    dispute_amount: { value: d.amount.value, currency_code: d.amount.currency },
    create_time: d.createTime, update_time: d.createTime, seller_response_due_date: d.sellerResponseDue,
    links: d.actions.map((rel) => ({ rel, href: `demo://disputes/${d.id}/${rel}`, method: rel === "self" ? "GET" : "POST" })),
    disputed_transactions: [{
      seller_transaction_id: d.transaction.id, invoice_number: d.transaction.invoiceId, create_time: d.transaction.createTime,
      gross_amount: { value: d.transaction.amount.value, currency_code: d.transaction.amount.currency },
      buyer: { name: d.transaction.buyerName, email: d.transaction.buyerEmail },
      items: [{ item_name: title }],
      ...(typeof d.sellerProtectionEligible === "boolean" ? { seller_protection_eligible: d.sellerProtectionEligible } : {}),
    }],
    evidences: [] as any[],
    demo: true,
  };
}

/** A stand-in for the PayPal client: the same methods the server calls, answered from memory. */
export class DemoPayPal {
  readonly base = "demo";
  disputes = new Map<string, ReturnType<typeof rawDispute>>();
  refunds = new Map<string, VerifiedRefund[]>();
  filings: { disputeId: string; at: string; input: unknown; files: { name: string; type: string; bytes: number }[] }[] = [];

  async listDisputes() { return { items: [...this.disputes.values()].map((d) => ({ dispute_id: d.dispute_id, update_time: d.update_time })) }; }
  async getDispute(id: string) {
    const d = this.disputes.get(id);
    if (!d) throw new Error(`Demo: no dispute ${id}`);
    return structuredClone(d);
  }
  async refundsForCapture(captureId: string) { return this.refunds.get(captureId) ?? []; }
  async verifyWebhook() { return false; }
  async call(): Promise<never> { throw new Error("Demo mode has no PayPal account: test sales need sandbox keys (see README, Run it)."); }

  /** Checks the multipart request as PayPal's provide-evidence does, then records it on the dispute. */
  async provideEvidence(id: string, form: FormData) {
    const d = this.disputes.get(id);
    if (!d) throw new Error(`Demo: no dispute ${id}`);
    if (!d.links.some((l) => l.rel === "provide_evidence")) throw demoRefusal("NOT_AUTHORIZED", "PayPal is not accepting evidence on this dispute now.");
    const part = form.get("input");
    const input = JSON.parse(part instanceof Blob ? await part.text() : String(part ?? "null"));
    const ev = input?.evidences?.[0];
    if (!ev?.evidence_type) throw demoRefusal("MISSING_REQUIRED_PARAMETER", "evidences[0].evidence_type");
    const files = [...form.entries()].filter(([k, v]) => k !== "input" && v instanceof Blob).map(([, v]) => v as File);
    let total = 0;
    for (const f of files) {
      if (!PAYPAL_DOC_NAME.test(f.name)) throw demoRefusal("INVALID_PARAMETER_SYNTAX", `document name ${f.name}`);
      if (!ALLOWED_MIME.has(f.type)) throw demoRefusal("INVALID_EVIDENCE_FILE", `${f.name} (${f.type})`);
      if (f.size > MAX_FILE_BYTES) throw demoRefusal("FILE_SIZE_EXCEEDED", f.name);
      total += f.size;
    }
    if (total > MAX_CALL_BYTES) throw demoRefusal("FILE_SIZE_EXCEEDED", "all files together");
    const names = new Set((ev.documents ?? []).map((x: any) => x.name));
    for (const f of files) if (!names.has(f.name)) throw demoRefusal("INVALID_PARAMETER_VALUE", `file ${f.name} is not listed in documents`);
    const at = new Date().toISOString();
    d.evidences.push({ source: "SUBMITTED_BY_SELLER", evidence_type: ev.evidence_type, date: at, notes: ev.notes, documents: files.map((f) => ({ name: f.name })) });
    d.status = "WAITING_FOR_BUYER_RESPONSE";
    d.links = d.links.filter((l) => !["provide_evidence", "accept_claim", "make_offer"].includes(l.rel));
    d.update_time = at;
    this.filings.push({ disputeId: id, at, input, files: files.map((f) => ({ name: f.name, type: f.type, bytes: f.size })) });
    return { links: [{ rel: "parent", href: `demo://disputes/${id}`, method: "GET" }] };
  }
}

class DemoRefusal extends Error { constructor(public status: number, public body: unknown) { super("PayPal (demo) refused the request"); } }
const demoRefusal = (issue: string, field: string) => new DemoRefusal(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue, field }] });
export const isDemoRefusal = (e: unknown): e is DemoRefusal => e instanceof DemoRefusal;

/** Loads every evaluation case into an empty store: disputes, payments, documents and their saved readings. */
export async function seedDemo(root: string, store: Store, pp: DemoPayPal, dataDir: string) {
  const casesDir = join(root, "eval", "cases");
  const readsDir = join(root, "eval", "runs", DEMO_RUN, "reads");
  const caseOf = new Map<string, string>();
  const ids = Array.from({ length: 30 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`).filter((id) => existsSync(join(casesDir, id, "case.json")));
  let t = Date.parse("2026-11-01T00:00:00Z");
  for (const cid of ids) {
    const c: EvalCase = JSON.parse(readFileSync(join(casesDir, cid, "case.json"), "utf8"));
    const raw = rawDispute(c.dispute, c.title);
    pp.disputes.set(raw.dispute_id, raw);
    pp.refunds.set(c.dispute.transaction.id, c.refunds);
    caseOf.set(raw.dispute_id, cid);
    store.upsertDispute(raw);
    const tx = c.dispute.transaction;
    store.armPayment({ txId: tx.id, invoiceId: tx.invoiceId, amount: tx.amount.value, currency: tx.amount.currency, payer: tx.buyerEmail, capturedAt: tx.createTime });
    const dir = join(dataDir, "files", tx.id);
    mkdirSync(dir, { recursive: true });
    for (const spec of c.docs) {
      const bytes = readFileSync(join(casesDir, cid, spec.name));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const id = `d${sha256.slice(0, 8)}${cid}`;
      const ext = extname(spec.name).toLowerCase();
      const path = join(dir, `${id}${ext}`);
      writeFileSync(path, bytes);
      let pdfPath: string | undefined, pdfBytes: number | undefined;
      if (ext === ".txt") {
        const pdf = await textToPdf(spec.name, bytes.toString("utf8"), sha256);
        pdfPath = join(dir, `${id}.pdf`);
        writeFileSync(pdfPath, pdf);
        pdfBytes = pdf.length;
      }
      // added_at orders the documents; keep the evaluation's order so statement references (F1, F2…) line up.
      store.addDoc({ id, txId: tx.id, name: spec.name, mime: MIME[ext] ?? "text/plain", bytes: bytes.length, sha256, path, pdfPath, pdfBytes, quarantined: false, addedAt: new Date(t++).toISOString() });
      const savedFile = join(readsDir, `${cid}__${spec.name}.json`);
      if (!existsSync(savedFile)) continue;
      const saved = JSON.parse(readFileSync(savedFile, "utf8"));
      const { facts, dropped } = toFacts(id, saved.output);
      store.saveRead({ docId: id, facts, dropped, docType: saved.output.document_type,
        quarantineQuote: saved.output.addressed_to_reader ? (saved.output.addressed_to_reader_quote ?? "(text addressed to an AI)") : undefined,
        costUsd: saved.costUsd ?? 0, readAt: DEMO_NOW });
    }
  }
  return caseOf;
}

/** The statement Muse Spark drafted for this case in the published run, if it drafted one. */
export function savedDraft(root: string, caseId: string): string | null {
  const f = join(root, "eval", "runs", DEMO_RUN, `${caseId}.draft.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).statement ?? null : null;
}
