// Assembles everything about one dispute: PayPal's record, the seller's locker, what the reader found, and the plan.
// Used by the server for display and, again from scratch, right before filing.
import { createHash } from "node:crypto";
import { disputeContext, toDisputeCase } from "./paypal/normalize";
import { planPack, type VerifiedRefund } from "./rules/engine";
import type { PayPal } from "./paypal/client";
import type { Store, StoredDoc } from "./store";
import type { EvidenceDoc, Fact } from "./types";

export const pdfName = (name: string) => name.replace(/\.[^.]+$/, "") + ".pdf";

/** What the rules engine sees: for text originals, the PDF copy (the only form PayPal accepts). */
export function engineDoc(d: StoredDoc): EvidenceDoc {
  return d.pdfPath ? { id: d.id, name: pdfName(d.name), mime: "application/pdf", bytes: d.pdfBytes ?? d.bytes, sha256: d.sha256, quarantined: d.quarantined }
    : { id: d.id, name: d.name, mime: d.mime, bytes: d.bytes, sha256: d.sha256, quarantined: d.quarantined };
}

const refundCache = new Map<string, { at: number; value: VerifiedRefund[] }>();
/** PayPal's own view of money held or returned on this payment. Only COMPLETED refunds count as evidence.
 * Cached for a minute (every statement check rebuilds the case and PayPal takes seconds); refresh and filing pass fresh. */
export async function refundsFor(pp: PayPal, txId: string, fresh = false): Promise<VerifiedRefund[]> {
  const hit = refundCache.get(txId);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.value;
  let value: VerifiedRefund[] = [];
  try { value = await pp.refundsForCapture(txId); } catch { /* PayPal unreachable: no refunds proven */ }
  refundCache.set(txId, { at: Date.now(), value });
  return value;
}

export async function buildCase(store: Store, pp: PayPal, disputeId: string, opts: { now?: string; fresh?: boolean } = {}) {
  const raw = store.dispute(disputeId);
  if (!raw) throw new Error(`Unknown dispute ${disputeId}. Sync with PayPal first.`);
  const dispute = toDisputeCase(raw);
  const docs = store.docs(dispute.transaction.id);
  const reads = docs.map((d) => ({ doc: d, read: store.read(d.id) }));
  const facts: Fact[] = reads.flatMap((r) => r.read?.facts ?? []);
  const refunds = await refundsFor(pp, dispute.transaction.id, opts.fresh);
  const plan = planPack({ dispute, facts, docs: docs.map(engineDoc), verifiedRefunds: refunds, now: opts.now });
  const held = refunds.filter((r) => r.status === "PENDING");
  return {
    dispute,
    context: disputeContext(raw),
    payment: store.payment(dispute.transaction.id) ?? null,
    docs: reads.map(({ doc, read }) => ({ ...engineDoc(doc), originalName: doc.name, originalMime: doc.mime, addedAt: doc.addedAt, read: read ?? null })),
    unread: reads.filter((r) => !r.read).length,
    facts,
    plan,
    planHash: hashPlan(plan),
    held: held.length ? { amount: held.reduce((s, r) => s + Number(r.amount.value), 0).toFixed(2), currency: held[0].amount.currency } : null,
    refunds,
    filings: store.filings(disputeId),
  };
}

/** The approval names a specific plan; filing is refused if anything changed since the person looked. */
export function hashPlan(plan: unknown): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}
