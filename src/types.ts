// Shared types. Field names that mirror PayPal's API keep PayPal's spelling (e.g. UNAUTHORISED).

export type DisputeReason =
  | "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
  | "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
  | "UNAUTHORISED"
  | "CREDIT_NOT_PROCESSED"
  | "DUPLICATE_TRANSACTION"
  | "INCORRECT_AMOUNT"
  | "PAYMENT_BY_OTHER_MEANS"
  | "CANCELED_RECURRING_BILLING"
  | "OTHER";

export type EvidenceType = "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND" | "OTHER";
export type Stage = "INQUIRY" | "CHARGEBACK" | "PRE_ARBITRATION" | "ARBITRATION";
export type Money = { value: string; currency: string };

/** What PayPal tells us about the dispute and the payment behind it (never from the AI). */
export interface DisputeCase {
  id: string;
  reason: DisputeReason;
  stage: Stage;
  status: string; // e.g. WAITING_FOR_SELLER_RESPONSE
  amount: Money;
  createTime: string; // ISO, when the buyer opened it
  sellerResponseDue?: string; // ISO
  actions: string[]; // HATEOAS link rels, e.g. ["provide_evidence", "accept_claim"]
  buyerStatement?: string;
  /** INTERNAL (PayPal) or EXTERNAL (the buyer's card issuer); affects Seller Protection */
  channel?: string;
  /** PayPal's own view of whether this payment is eligible for Seller Protection (null = not said) */
  sellerProtectionEligible?: boolean | null;
  transaction: {
    id: string; // seller transaction (capture) id
    invoiceId?: string; // merchant's own order/invoice reference, if PayPal has it
    createTime: string; // ISO, when the buyer paid
    amount: Money;
    buyerName?: string;
    buyerEmail?: string;
  };
}

/** Where a fact came from: the document, page, and the exact words. */
export interface Cite {
  docId: string;
  page?: number;
  quote: string;
}

/** Facts the AI read from the seller's own documents. Every fact carries its quote. */
export type Fact =
  | { id: string; kind: "tracking"; carrier: string; trackingNumber: string; status?: "shipped" | "delivered"; at?: string; recipient?: string; orderRef?: string; cite: Cite }
  | { id: string; kind: "delivery"; method: "digital" | "physical" | "service"; at: string; detail: string; recipient?: string; orderRef?: string; cite: Cite;
      /** set when the record gives a date without a year (at is then ""): the engine resolves it against the payment date */
      atText?: string }
  | { id: string; kind: "refund"; refundId: string; amount?: Money; at?: string; cite: Cite }
  | { id: string; kind: "invoice"; orderRef?: string; transactionId?: string; buyer?: string; amount?: Money; at?: string; cite: Cite }
  | { id: string; kind: "description"; text: string; cite: Cite }
  | { id: string; kind: "policy"; policy: "return" | "refund" | "terms" | "subscription" | "cancellation"; text: string; cite: Cite }
  | { id: string; kind: "communication"; at?: string; from: "buyer" | "seller"; text: string; cite: Cite }
  | { id: string; kind: "acknowledgement"; at?: string; text: string; cite: Cite };

export type FactKind = Fact["kind"];

/** A document the seller supplied. Only these file types may be sent to PayPal. */
export interface EvidenceDoc {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
  /** set when the reader found text addressed to an AI ("ignore your instructions…"); such docs are never used */
  quarantined?: boolean;
}

export type CheckStatus = "ok" | "missing" | "conflict" | "warn";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  /** required checks block filing when not ok; recommended ones only lower the score */
  required: boolean;
  detail: string;
  factIds: string[];
}

export type Verdict =
  | "READY" // complete and consistent: may be filed once a person approves
  | "INCOMPLETE" // a required item is missing; says exactly which
  | "CONFLICT" // the evidence contradicts itself or PayPal's records; must not be filed
  | "NO_DEFENCE"; // nothing defensible; refunding is likely cheaper than fighting

export interface PackPlan {
  verdict: Verdict;
  evidenceType?: EvidenceType;
  /** PayPal's evidence_info for the chosen type */
  evidenceInfo: { tracking_info?: { carrier_name: string; carrier_name_other?: string; tracking_number: string }[]; refund_ids?: string[] };
  /** facts that support the chosen evidence type (the statement may only cite these) */
  usedFactIds: string[];
  /** documents to attach (ids), in order */
  documentIds: string[];
  checks: Check[];
  /** 0..100: share of required + recommended checks that are ok */
  completeness: number;
  /** can the seller file right now (PayPal offers provide_evidence)? */
  canFileNow: boolean;
  /** plain-language reasons for the verdict, shown to the seller */
  reasons: string[];
  /** what to do instead / next */
  suggestion?: string;
  daysLeft?: number;
  /** A second, stricter bar than "PayPal accepts this evidence": would PayPal's Seller Protection likely cover it? */
  /** sha256 of the facts used and the attached files' hashes: approval is bound to it */
  evidenceFingerprint: string;
  protection: { level: "LIKELY" | "UNLIKELY" | "NOT_COVERED" | "NOT_APPLICABLE" | "NOT_ASSESSED"; reasons: string[] };
}
