// The words the interface uses for PayPal's codes. Plain language; the codes stay visible where they matter.
import type { Verdict } from "../../src/types";
export { REASON_LABEL } from "../../src/rules/paypalRules";

export const VERDICT_WORD: Record<Verdict, string> = {
  READY: "Ready to file",
  INCOMPLETE: "Something PayPal needs is missing",
  CONFLICT: "The evidence contradicts itself",
  NO_DEFENCE: "Nothing here PayPal would accept",
};

export const STATUS_WORD: Record<string, string> = {
  OPEN: "Open",
  WAITING_FOR_SELLER_RESPONSE: "Waiting for your response",
  WAITING_FOR_BUYER_RESPONSE: "Waiting for the buyer",
  UNDER_REVIEW: "PayPal is reviewing",
  RESOLVED: "Resolved",
  OTHER: "Other",
};

export const STAGE_WORD: Record<string, string> = {
  INQUIRY: "Inquiry (you and the buyer)",
  CHARGEBACK: "Claim (PayPal decides)",
  PRE_ARBITRATION: "First appeal",
  ARBITRATION: "Second appeal",
};

export const EVIDENCE_WORD: Record<string, string> = {
  PROOF_OF_FULFILLMENT: "Proof of fulfilment",
  PROOF_OF_REFUND: "Proof of refund",
  OTHER: "Supporting documents",
};

export const KIND_WORD: Record<string, string> = {
  tracking: "Tracking", delivery: "Delivery", refund: "Refund", invoice: "Invoice", description: "What was sold",
  policy: "Policy", communication: "Message", acknowledgement: "Buyer confirmed",
};

export const money = (v?: string | null, c?: string | null) => (v ? `${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c ?? ""}`.trim() : "");
export const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
/** "5 Nov 2026, 16:05 UTC" for a timestamp with a zone; the date alone when the document gave only a date. */
export const when = (iso?: string | null) => {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return day(iso);
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const zoned = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  const hhmm = zoned ? new Date(t).toISOString().slice(11, 16) + " UTC" : iso.slice(11, 16);
  return `${day(zoned ? iso : iso.slice(0, 10))}, ${hhmm}`;
};
// Demo mode runs on the evaluation's clock, so deadlines read as they did when the set was scored.
let clockOffset = 0;
/** True when the server runs npm run demo: PayPal is simulated. */
export let DEMO = false;
export const setDemo = (v: boolean | undefined) => { DEMO = !!v; };
export const setClock = (iso: string | null | undefined) => { clockOffset = iso ? Date.parse(iso) - Date.now() : 0; };
export const daysLeft = (iso?: string | null) => (iso ? Math.floor((Date.parse(iso) - (Date.now() + clockOffset)) / 86_400_000) : null);

export const PROTECTION_WORD: Record<string, string> = {
  LIKELY: "Seller Protection: likely to apply",
  UNLIKELY: "Seller Protection: unlikely",
  NOT_COVERED: "Seller Protection: not covered",
  NOT_APPLICABLE: "Seller Protection: not needed",
  NOT_ASSESSED: "Seller Protection: not assessed for this reason",
};
