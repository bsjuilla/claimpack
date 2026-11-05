// Turns PayPal's dispute JSON into ClaimPack's DisputeCase. Field names verified against a real sandbox dispute
// (tests/fixtures/dispute-sandbox.json, 5 Nov 2026).
import type { DisputeCase, DisputeReason, Stage } from "../types";

export function toDisputeCase(raw: any): DisputeCase {
  const tx = raw.disputed_transactions?.[0] ?? {};
  const buyerWords = [
    ...(raw.messages ?? []).filter((m: any) => m.posted_by === "BUYER").map((m: any) => m.content),
    ...(raw.evidences ?? []).filter((e: any) => e.source === "SUBMITTED_BY_BUYER").map((e: any) => e.notes),
  ].filter(Boolean);
  return {
    id: raw.dispute_id,
    reason: raw.reason as DisputeReason,
    stage: (raw.dispute_life_cycle_stage ?? "INQUIRY") as Stage,
    status: raw.status,
    amount: { value: raw.dispute_amount?.value, currency: raw.dispute_amount?.currency_code },
    createTime: raw.create_time,
    sellerResponseDue: raw.seller_response_due_date,
    actions: (raw.links ?? []).map((l: any) => l.rel),
    buyerStatement: [...new Set(buyerWords)].join("\n") || undefined,
    transaction: {
      id: tx.seller_transaction_id,
      invoiceId: tx.invoice_number || undefined,
      createTime: tx.create_time,
      amount: { value: tx.gross_amount?.value, currency: tx.gross_amount?.currency_code },
      buyerName: tx.buyer?.name || undefined,
      buyerEmail: tx.buyer?.email || undefined,
    },
  };
}

/** Extra context for the seller (not used by the rules): what was bought and PayPal's seller-protection view. */
export function disputeContext(raw: any) {
  const tx = raw.disputed_transactions?.[0] ?? {};
  return {
    items: (tx.items ?? []).map((i: any) => ({ name: i.item_name ?? i.item_description, quantity: i.item_quantity, notes: i.notes })),
    sellerProtectionEligible: tx.seller_protection_eligible ?? null,
    sellerProtectionType: tx.seller_protection_type ?? null,
    buyerRequested: raw.offer?.buyer_requested_amount ? { value: raw.offer.buyer_requested_amount.value, currency: raw.offer.buyer_requested_amount.currency_code } : null,
    sellerEvidenceFiled: (raw.evidences ?? []).filter((e: any) => e.source === "SUBMITTED_BY_SELLER").map((e: any) => ({ type: e.evidence_type, date: e.date, notes: e.notes, documents: (e.documents ?? []).map((x: any) => x.name) })),
  };
}
