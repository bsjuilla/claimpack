// PayPal's published rules, as data. Source: developer.paypal.com/disputes/reasons-evidence (updated 5 Jun 2026),
// /disputes/disputes-lifecycle (14 Oct 2026) and /disputes/supported-file-sizes-types (21 May 2026), read 5 Nov 2026.
import type { DisputeReason, EvidenceType } from "../types";

/** Evidence types PayPal accepts for each dispute reason, in the order ClaimPack prefers them. */
export const ALLOWED_EVIDENCE: Record<DisputeReason, EvidenceType[]> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: ["PROOF_OF_REFUND", "PROOF_OF_FULFILLMENT"],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: ["PROOF_OF_REFUND", "OTHER"],
  UNAUTHORISED: ["PROOF_OF_REFUND", "PROOF_OF_FULFILLMENT", "OTHER"],
  CREDIT_NOT_PROCESSED: ["PROOF_OF_REFUND", "OTHER"],
  DUPLICATE_TRANSACTION: ["PROOF_OF_REFUND", "OTHER"],
  INCORRECT_AMOUNT: ["PROOF_OF_REFUND", "OTHER"],
  PAYMENT_BY_OTHER_MEANS: ["PROOF_OF_REFUND", "OTHER"],
  CANCELED_RECURRING_BILLING: ["PROOF_OF_REFUND", "OTHER"],
  OTHER: ["PROOF_OF_REFUND", "OTHER"],
};

export const REASON_LABEL: Record<DisputeReason, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item or service not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised payment",
  CREDIT_NOT_PROCESSED: "Refund or credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate payment",
  INCORRECT_AMOUNT: "Charged the wrong amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  CANCELED_RECURRING_BILLING: "Charged after cancelling a subscription",
  OTHER: "Other",
};

/** Only these may be uploaded to PayPal as evidence. */
export const ALLOWED_MIME = new Set(["image/jpeg", "image/gif", "image/png", "application/pdf"]);
export const MAX_FILE_BYTES = 10 * 1024 * 1024 - 1; // "less than 10 MB per file"
export const MAX_CALL_BYTES = 50 * 1024 * 1024; // "up to 50 MB per API call"

/** HATEOAS rel PayPal uses when the seller may file evidence. */
export const PROVIDE_EVIDENCE_REL = "provide_evidence";
