// The rules engine: decides, from PayPal's published rules and PayPal's own records, what can be filed for a dispute.
// It never asks a model anything. Facts come from the reader (with quotes); this code decides what they are worth.
import { createHash } from "node:crypto";
import type { Check, Cite, DisputeCase, EvidenceDoc, EvidenceType, Fact, Money, PackPlan } from "../types";
import { looseDateReadings, resolveLooseDate } from "./dates";
import { ALLOWED_EVIDENCE, ALLOWED_MIME, MAX_CALL_BYTES, MAX_FILE_BYTES, PROVIDE_EVIDENCE_REL } from "./paypalRules";

/** A refund PayPal itself reports for this payment (looked up by the server, never read from a document). */
export interface VerifiedRefund {
  id: string;
  captureId: string;
  amount: Money;
  status: string; // COMPLETED, PENDING, …
}

export interface EngineInput {
  dispute: DisputeCase;
  facts: Fact[];
  docs: EvidenceDoc[];
  verifiedRefunds?: VerifiedRefund[];
  now?: string; // ISO; defaults to the current time
}

const DAY = 86_400_000;
const norm = (s: string) => s.toLowerCase().replace(/^#/, "").replace(/[\s\-_.#]/g, "");
const money = (m: Money) => Math.round(Number(m.value) * 100);
/** A money value ClaimPack can trust to compare: plain digits with at most two decimals ("120.00.99" is not). */
export const validMoney = (m?: Money) => !!m && /^\d{1,9}(\.\d{1,2})?$/.test(m.value) && /^[A-Z]{3}$/.test(m.currency);
/** A delivery record that says the delivery did not happen is not proof of delivery (adversarial review E12, R01). */
export const DELIVERY_FAILED = /\b(fail(ed|s|ure)?|bounced|undeliver\w*|not\s+(been\s+)?deliver\w*|never\s+(accessed|opened|downloaded|received|arrived)|returned\s+to\s+sender|refused|rejected|expired|lost\s+in\s+transit|cancel+ed)\b/i;
const t = (iso?: string) => (iso ? Date.parse(iso) : NaN);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9@.]+/).filter((w) => w.length > 1));

/** Does a name or email in a document plausibly refer to the buyer PayPal knows? undefined = cannot tell. */
export function sameBuyer(who: string | undefined, d: DisputeCase["transaction"]): boolean | undefined {
  if (!who || (!d.buyerName && !d.buyerEmail)) return undefined;
  const w = who.toLowerCase();
  if (d.buyerEmail && w.includes(d.buyerEmail.toLowerCase())) return true;
  if (d.buyerName) {
    // Every word of the shorter name must be in the longer one: "John Doe" matches "John Michael Doe", but
    // "John Michael Roe" does not (sharing two words is not enough; adversarial review E03).
    const a = words(who), b = words(d.buyerName);
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    if (small.size >= Math.min(2, b.size) && [...small].every((x) => big.has(x))) return true;
  }
  return false;
}

/** Does an order reference in a document match this payment? undefined = the document names no order. */
export function sameOrder(ref: string | undefined, d: DisputeCase["transaction"]): boolean | undefined {
  if (!ref || !ref.trim()) return undefined;
  const r = norm(ref);
  if (norm(d.id) === r) return true;
  if (d.invoiceId) return norm(d.invoiceId) === r;
  // PayPal holds no invoice number for this payment, so the seller's own order number can be neither confirmed nor
  // refuted, unless it is itself a PayPal transaction ID (17 letters and digits) for a different payment.
  return /^[0-9A-Z]{17}$/i.test(ref.trim()) ? false : undefined;
}

function refOf(f: Fact): string | undefined {
  if (f.kind === "invoice") return f.transactionId ?? f.orderRef;
  if (f.kind === "tracking" || f.kind === "delivery") return f.orderRef;
  return undefined;
}
function personOf(f: Fact): string | undefined {
  if (f.kind === "invoice") return f.buyer;
  if (f.kind === "tracking" || f.kind === "delivery") return f.recipient;
  return undefined;
}

export function planPack(input: EngineInput): PackPlan {
  const { dispute: d, docs } = input;
  const now = t(input.now) || Date.now();
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const reasons: string[] = [];

  // 1. Documents: quarantined or unsendable files are never used.
  const docById = new Map(docs.map((x) => [x.id, x]));
  const docName = (id: string) => docById.get(id)?.name ?? id;
  const quarantined = docs.filter((x) => x.quarantined);
  if (quarantined.length)
    add({ id: "quarantine", label: "Documents with instructions aimed at an AI were set aside", status: "warn", required: false,
      detail: `${quarantined.map((x) => x.name).join(", ")}: contains text addressed to an AI reader, so nothing from it is used.`, factIds: [] });
  const usableDoc = (id: string) => { const x = docById.get(id); return !!x && !x.quarantined; };

  // 2. Which facts belong to this payment? Foreign facts are set aside; contradictions block filing.
  const facts: Fact[] = [];
  for (let f of input.facts) {
    if (!usableDoc(f.cite.docId)) continue;
    // Dates must be real dates (adversarial review E07, R02): an unreadable one is treated as missing.
    if ((f.kind === "delivery" || f.kind === "tracking") && f.at && Number.isNaN(Date.parse(f.at))) f = { ...f, at: f.kind === "delivery" ? "" : undefined } as Fact;
    if (f.kind === "delivery" && !f.at) {
      const at = f.atText ? resolveLooseDate(f.atText, d.transaction.createTime) : undefined;
      if (!at) {
        add({ id: `nodate-${f.id}`, label: "Delivery record without a readable date was set aside", status: "warn", required: false,
          detail: `${docName(f.cite.docId)}: "${f.cite.quote.slice(0, 60)}" has no date ClaimPack can read, so it is not used as proof.`, factIds: [f.id] });
        continue;
      }
      const readings = looseDateReadings(f.atText!, d.transaction.createTime);
      add({ id: `date-${f.id}`, label: "Date written without a year", status: "warn", required: false,
        detail: `${docName(f.cite.docId)} says "${f.atText!.slice(0, 40)}"; ClaimPack read it as ${at.slice(0, 10)}, the reading nearest the payment on ${d.transaction.createTime.slice(0, 10)}` +
          (readings.length > 1 ? ` (it could also be read as ${readings.filter((r) => r !== at.slice(0, 10)).join(" or ")})` : "") + ". Check it before filing.", factIds: [f.id] });
      f = { ...f, at };
    }
    if ((f.kind === "delivery" || f.kind === "tracking") && DELIVERY_FAILED.test(`${f.cite.quote} ${"detail" in f ? f.detail : ""}`)) {
      add({ id: `failed-${f.id}`, label: "A record says the delivery did not succeed", status: "warn", required: false,
        detail: `${docName(f.cite.docId)}: "${f.cite.quote.slice(0, 80)}". It is not used as proof of delivery.`, factIds: [f.id] });
      continue;
    }
    const order = sameOrder(refOf(f), d.transaction);
    const person = sameBuyer(personOf(f), d.transaction);
    if (order === false || (order === undefined && person === false)) {
      add({ id: `foreign-${f.id}`, label: "Document about a different order was set aside", status: "warn", required: false,
        detail: `${docName(f.cite.docId)}: ${order === false ? `refers to order "${refOf(f)}"` : `names "${personOf(f)}"`}, not this payment (${d.transaction.id}${d.transaction.invoiceId ? ` / ${d.transaction.invoiceId}` : ""}).`, factIds: [f.id] });
      continue;
    }
    if (order === true && person === false) {
      add({ id: `who-${f.id}`, label: "Same order, different person", status: "conflict", required: true,
        detail: `${docName(f.cite.docId)} matches this order but names "${personOf(f)}", while PayPal's buyer is ${d.transaction.buyerName ?? d.transaction.buyerEmail}.`, factIds: [f.id] });
    }
    facts.push(f);
  }
  const of = <K extends Fact["kind"]>(k: K) => facts.filter((f): f is Extract<Fact, { kind: K }> => f.kind === k);

  // 3. Checks against PayPal's records that apply whatever the evidence type.
  for (const inv of of("invoice")) {
    if (inv.amount && !validMoney(inv.amount))
      add({ id: `amount-${inv.id}`, label: "Invoice amount could not be read", status: "conflict", required: true,
        detail: `${docName(inv.cite.docId)} gives the amount as "${inv.amount.value} ${inv.amount.currency}", which is not a valid amount. Check the document.`, factIds: [inv.id] });
    else if (inv.amount && (inv.amount.currency !== d.transaction.amount.currency || money(inv.amount) !== money(d.transaction.amount)))
      add({ id: `amount-${inv.id}`, label: "Invoice amount differs from what PayPal charged", status: "conflict", required: true,
        detail: `${docName(inv.cite.docId)} says ${inv.amount.value} ${inv.amount.currency}; PayPal charged ${d.transaction.amount.value} ${d.transaction.amount.currency}.`, factIds: [inv.id] });
  }
  // Refunds PayPal confirms for THIS payment, completed, in the dispute's currency, counted once each (reviews E10, E11, B2, B3).
  const seen = new Set<string>();
  const verified = (input.verifiedRefunds ?? []).filter((r) => {
    if (r.captureId !== d.transaction.id || r.status !== "COMPLETED" || !validMoney(r.amount) || seen.has(r.id)) return false;
    seen.add(r.id);
    if (r.amount.currency !== d.amount.currency) {
      add({ id: `refund-currency-${r.id}`, label: "Refund in a different currency", status: "warn", required: false,
        detail: `PayPal refund ${r.id} is ${r.amount.value} ${r.amount.currency}; the dispute is in ${d.amount.currency}, so it is not counted.`, factIds: [] });
      return false;
    }
    return true;
  });
  for (const r of of("refund")) {
    if (!verified.some((v) => v.id === r.refundId))
      add({ id: `refund-${r.id}`, label: "Refund ID not found in PayPal for this payment", status: "conflict", required: true,
        detail: `${docName(r.cite.docId)} mentions refund "${r.refundId}", but PayPal has no completed refund with that ID for ${d.transaction.id}.`, factIds: [r.id] });
  }
  for (const f of [...of("delivery"), ...of("tracking")]) {
    const at = t(f.at);
    if (Number.isNaN(at)) continue;
    if (at < t(d.transaction.createTime) - DAY)
      add({ id: `early-${f.id}`, label: "Delivered before the payment", status: "warn", required: false,
        detail: `${docName(f.cite.docId)} dates delivery ${f.at!.slice(0, 10)}, before the payment on ${d.transaction.createTime.slice(0, 10)}. Fine for a service billed afterwards; otherwise check the document.`, factIds: [f.id] });
    if (at > t(d.createTime))
      add({ id: `late-${f.id}`, label: "Delivered after the buyer opened the dispute", status: "warn", required: false,
        detail: `${docName(f.cite.docId)} dates delivery ${f.at!.slice(0, 10)}; the dispute opened ${d.createTime.slice(0, 10)}. Still proof of delivery, but expect the buyer to question it.`, factIds: [f.id] });
  }

  // 4. Choose the evidence type: a refund PayPal can confirm beats everything; otherwise PayPal's list for the reason.
  const allowed = ALLOWED_EVIDENCE[d.reason];
  const refunded = verified.reduce((s, r) => s + money(r.amount), 0);
  let type: EvidenceType | undefined;
  const evidenceInfo: PackPlan["evidenceInfo"] = {};
  const used: string[] = [];

  // A refund proves the case only if it covers what is disputed (for a wrong amount, the dispute amount is the difference).
  if (verified.length && refunded >= money(d.amount)) {
    type = "PROOF_OF_REFUND";
    evidenceInfo.refund_ids = verified.map((r) => r.id);
    used.push(...of("refund").filter((r) => verified.some((v) => v.id === r.refundId)).map((r) => r.id));
    add({ id: "refund", label: "Refund confirmed by PayPal", status: "ok", required: true,
      detail: `PayPal shows ${verified.length} completed refund(s) totalling ${(refunded / 100).toFixed(2)} ${d.amount.currency} for this payment.`, factIds: used.slice() });
  } else {
    if (verified.length)
      add({ id: "partial-refund", label: "Partial refund only", status: "warn", required: false,
        detail: `PayPal shows ${(refunded / 100).toFixed(2)} refunded of ${d.amount.value} disputed; not enough on its own.`, factIds: [] });
    const r = requirementsFor(d, of, allowed);
    type = r.type;
    for (const c of r.checks) add(c);
    used.push(...r.used);
    if (r.tracking.length) evidenceInfo.tracking_info = r.tracking;
  }

  // 5. Documents to attach: those behind the facts used, if PayPal accepts the file type and size.
  const documentIds: string[] = [];
  let totalBytes = 0;
  for (const id of [...new Set(facts.filter((f) => used.includes(f.id)).map((f) => f.cite.docId))]) {
    const doc = docById.get(id)!;
    if (!ALLOWED_MIME.has(doc.mime)) {
      add({ id: `type-${id}`, label: "File type PayPal does not accept", status: "warn", required: false,
        detail: `${doc.name} (${doc.mime}) cannot be uploaded; its facts go into the generated summary PDF instead.`, factIds: [] });
      continue;
    }
    if (doc.bytes > MAX_FILE_BYTES || totalBytes + doc.bytes > MAX_CALL_BYTES) {
      add({ id: `size-${id}`, label: "File too large for PayPal", status: "warn", required: false,
        detail: `${doc.name} is ${(doc.bytes / 1048576).toFixed(1)} MB; PayPal takes under 10 MB per file and 50 MB per filing.`, factIds: [] });
      continue;
    }
    totalBytes += doc.bytes;
    documentIds.push(id);
  }

  // 6. Deadline.
  let daysLeft: number | undefined;
  if (d.sellerResponseDue) {
    daysLeft = Math.floor((t(d.sellerResponseDue) - now) / DAY);
    if (daysLeft < 0) add({ id: "deadline", label: "Response deadline has passed", status: "conflict", required: true, detail: `PayPal's deadline was ${d.sellerResponseDue.slice(0, 10)}.`, factIds: [] });
    else if (daysLeft <= 3) add({ id: "deadline", label: `Only ${daysLeft} day(s) left to respond`, status: "warn", required: false, detail: `PayPal's deadline is ${d.sellerResponseDue.slice(0, 10)}.`, factIds: [] });
  }

  // 6b. Stage. PayPal lists provide-evidence as a claim-stage action; in the inquiry stage it is offered by the sandbox,
  // but the buyer and seller are expected to settle first (reviews G1).
  if (d.stage === "INQUIRY")
    add({ id: "stage-inquiry", label: "Inquiry stage: you can still settle with the buyer", status: "warn", required: false,
      detail: "PayPal is not deciding yet. A message or a refund offer may end it sooner; evidence filed now is what PayPal reads if it becomes a claim.", factIds: [] });

  // 7. Verdict. Code decides; nothing here depends on how confident a model sounded.
  const req = checks.filter((c) => c.required);
  const scored = checks.filter((c) => c.required || c.id.startsWith("rec-"));
  const completeness = scored.length ? Math.round((100 * scored.filter((c) => c.status === "ok").length) / scored.length) : 0;
  const canFileNow = d.actions.includes(PROVIDE_EVIDENCE_REL);
  let verdict: PackPlan["verdict"];
  let suggestion: string | undefined;
  if (req.some((c) => c.status === "conflict")) {
    verdict = "CONFLICT";
    reasons.push(...req.filter((c) => c.status === "conflict").map((c) => c.label));
    suggestion = "Resolve the contradictions before filing: PayPal takes one evidence filing per stage, and a contradictory pack weakens the case.";
  } else if (req.every((c) => c.status === "ok") && type) {
    verdict = "READY";
    reasons.push(`Everything PayPal asks for under ${type} is present and consistent with PayPal's records.`);
    if (!canFileNow) suggestion = "PayPal does not offer \"provide evidence\" on this dispute right now. The pack is ready for when it does.";
  } else if (used.length === 0) {
    verdict = "NO_DEFENCE";
    reasons.push("None of the documents supports any evidence type PayPal accepts for this reason.");
    const offers = [d.actions.includes("make_offer") && "make an offer", d.actions.includes("accept_claim") && "accept the claim"].filter(Boolean);
    suggestion = `Refunding is likely cheaper than fighting${offers.length ? ` (PayPal lets you ${offers.join(" or ")})` : ""}, unless you have documents not uploaded yet.`;
  } else {
    verdict = "INCOMPLETE";
    reasons.push(...req.filter((c) => c.status !== "ok").map((c) => `Missing: ${c.label}`));
    suggestion = "Add the missing items, then check again.";
  }

  const protection = protectionFor(d, facts.filter((f) => used.includes(f.id)), type);
  // What the person approves is bound to the evidence itself: the facts used (with their quotes) and the bytes of
  // every attached file. Change either and the approval no longer matches (reviews A02, A03).
  const evidenceFingerprint = createHash("sha256").update(JSON.stringify({
    facts: facts.filter((f) => used.includes(f.id)),
    files: documentIds.map((id) => ({ id, sha256: docById.get(id)!.sha256, bytes: docById.get(id)!.bytes })),
  })).digest("hex");
  return { verdict, evidenceType: type, evidenceInfo, usedFactIds: [...new Set(used)], documentIds, checks, completeness, canFileNow, reasons, suggestion, daysLeft, protection, evidenceFingerprint };
}

/**
 * The second bar. "PayPal accepts this evidence" (the verdict) is not "PayPal's Seller Protection would cover it".
 * From PayPal's Seller Protection policy (paypal.com/us/legalhub/paypal/seller-protection, read for the 7 Nov reviews):
 * physical item-not-received needs tracking with a delivered status, date and a recipient address matching the
 * shipping address; intangible items need a record of the date sent and the recipient's email/IP or their access;
 * not-as-described claims and item-not-received claims filed with a card issuer are not covered. Every evidence fact is
 * the seller's own document: ClaimPack cannot vouch that it is genuine, and says so.
 */
function protectionFor(d: DisputeCase, used: Fact[], type?: EvidenceType): PackPlan["protection"] {
  const own = "These are your own documents: ClaimPack checks them against PayPal's rules and records, not whether they are genuine.";
  if (type === "PROOF_OF_REFUND") return { level: "NOT_APPLICABLE", reasons: ["You have already refunded the buyer through PayPal."] };
  if (d.sellerProtectionEligible === false) return { level: "NOT_COVERED", reasons: ["PayPal marks this payment as not eligible for Seller Protection.", own] };
  if (d.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED")
    return { level: "NOT_COVERED", reasons: ["PayPal Seller Protection does not cover \"not as described\" claims. PayPal still reads your evidence; compare it with the cost of a refund.", own] };
  if (d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && d.channel === "EXTERNAL")
    return { level: "NOT_COVERED", reasons: ["Item-not-received claims filed with the buyer's card issuer are not covered by Seller Protection.", own] };
  if (d.reason !== "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && d.reason !== "UNAUTHORISED")
    return { level: "NOT_ASSESSED", reasons: ["Seller Protection covers item-not-received and unauthorised payments; this reason is decided on the evidence alone.", own] };
  const buyer = (who?: string) => sameBuyer(who, d.transaction) === true;
  const physical = used.filter((f): f is Extract<Fact, { kind: "tracking" }> => f.kind === "tracking");
  const goodPhysical = physical.filter((f) => f.status === "delivered" && !!f.at && buyer(f.recipient));
  if (goodPhysical.length)
    return { level: "LIKELY", reasons: ["Tracking shows a delivered status with a date, to the buyer PayPal knows.", "ClaimPack cannot yet compare the delivery address with the shipping address on the PayPal transaction; PayPal requires them to match.", own] };
  const digital = used.filter((f): f is Extract<Fact, { kind: "delivery" }> => f.kind === "delivery" && f.method !== "physical");
  const reached = (f: Extract<Fact, { kind: "delivery" }>) => buyer(f.recipient) || /@|\b\d{1,3}(\.\d{1,3}){3}\b/.test(f.cite.quote) || /\b(download|opened|accessed|viewed|logged in)/i.test(`${f.detail} ${f.cite.quote}`);
  if (digital.some((f) => !!f.at && reached(f)))
    return { level: "LIKELY", reasons: ["A dated record shows the item was sent to the buyer's address or accessed by them, which is what PayPal asks for intangible items.", own] };
  const missing: string[] = [];
  if (physical.length && !physical.some((f) => f.status === "delivered")) missing.push("tracking does not show \"delivered\"");
  if (physical.length && !physical.some((f) => buyer(f.recipient))) missing.push("tracking does not name the buyer as recipient");
  if (digital.length && !digital.some(reached)) missing.push("the delivery record shows neither the buyer's email or IP address nor that they opened the files");
  if (!physical.length && !digital.length) missing.push("the only proof is a message, which is not one of the proofs PayPal lists");
  return { level: "UNLIKELY", reasons: [`Seller Protection looks unlikely: ${missing.join("; ")}.`, own] };
}

type Of = <K extends Fact["kind"]>(k: K) => Extract<Fact, { kind: K }>[];

/** What PayPal needs for the reason, and what the facts provide. Required checks gate filing. */
function requirementsFor(d: DisputeCase, of: Of, allowed: EvidenceType[]) {
  const checks: Check[] = [];
  const used: string[] = [];
  const tracking: NonNullable<PackPlan["evidenceInfo"]["tracking_info"]> = [];
  const ok = (c: Omit<Check, "status" | "factIds">, facts: Fact[]): boolean => {
    checks.push({ ...c, status: facts.length ? "ok" : "missing", factIds: facts.map((f) => f.id) });
    if (facts.length) used.push(...facts.map((f) => f.id));
    return facts.length > 0;
  };
  const linked = (fs: Fact[]) => fs.filter((f) => sameOrder(refOf(f), d.transaction) === true || sameBuyer(personOf(f), d.transaction) === true);
  const recLinked = (fs: Fact[]) => {
    if (!fs.length) return;
    const l = linked(fs);
    const refs = [...new Set(fs.map(refOf).filter(Boolean))];
    const detail = l.length ? "At least one document names this payment's order number or the buyer."
      : refs.length && !d.transaction.invoiceId ? `Your documents say ${refs.join(", ")}, but PayPal's record of this payment has no invoice number, so PayPal may not connect them. Send your order number as invoice_id when you create PayPal orders.`
      : "No document names the order number or the buyer; PayPal may not connect it to this payment.";
    checks.push({ id: "rec-linked", label: "Evidence names this order or buyer", status: l.length ? "ok" : "warn", required: false, detail, factIds: l.map((f) => f.id) });
  };

  const trackingFacts = of("tracking").filter((f) => f.carrier && f.trackingNumber);
  const deliveryFacts = of("delivery");

  switch (d.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": {
      // PayPal: carrier + tracking number, OR notes/documents proving delivery.
      const proof = [...trackingFacts, ...deliveryFacts, ...of("acknowledgement")];
      ok({ id: "fulfilment", label: "Proof the order was delivered (tracking, delivery record or buyer's confirmation)", required: true,
        detail: "PayPal asks for carrier + tracking number, or documents proving delivery." }, proof);
      for (const f of trackingFacts) tracking.push(trackingInfo(f));
      // Required since the 7 Nov reviews: PayPal's Seller Protection asks for a "delivered" status and date for physical
      // goods, so tracking that only shows the parcel shipped or in transit leaves the pack incomplete.
      // The buyer's own confirmation shows the delivery happened even when the message carries no date.
      const delivered = proof.filter((f) => (f.kind === "tracking" ? f.status === "delivered" : f.kind === "acknowledgement" ? true : !!f.at));
      if (proof.length) checks.push({ id: "delivered", label: "Delivery is confirmed (delivered status, a dated delivery record, or the buyer's confirmation)", required: true,
        status: delivered.length ? "ok" : "missing",
        detail: delivered.length ? "A record shows the delivery happened." : "The tracking shows the parcel shipped or in transit, not delivered. Add the carrier's delivery confirmation.", factIds: delivered.map((f) => f.id) });
      recLinked(proof);
      // What was sold: lets PayPal match the delivered files to the order (attached as supporting documents).
      ok({ id: "rec-what-sold", label: "What was sold (invoice or listing)", required: false, detail: "Shows PayPal that what was delivered is what the buyer paid for." },
        [...linked(of("invoice")), ...of("description")]);
      return { type: "PROOF_OF_FULFILLMENT" as EvidenceType, checks, used, tracking };
    }
    case "UNAUTHORISED": {
      if (trackingFacts.length && allowed.includes("PROOF_OF_FULFILLMENT")) {
        ok({ id: "fulfilment", label: "Carrier and tracking number for the shipment", required: true, detail: "PayPal asks for carrier + tracking number." }, trackingFacts);
        for (const f of trackingFacts) tracking.push(trackingInfo(f));
        const toBuyer = trackingFacts.filter((f) => sameBuyer(f.recipient, d.transaction) === true);
        checks.push({ id: "rec-to-buyer", label: "Shipped to the account holder", status: toBuyer.length ? "ok" : "warn", required: false,
          detail: toBuyer.length ? "Tracking shows the PayPal account holder as recipient." : "Tracking does not show the account holder as recipient.", factIds: toBuyer.map((f) => f.id) });
        return { type: "PROOF_OF_FULFILLMENT" as EvidenceType, checks, used, tracking };
      }
      ok({ id: "other-auth", label: "Documents showing the account holder made or received the order", required: true,
        detail: "PayPal accepts notes or documents, e.g. proof of delivery signature or receipt copy." },
        [...deliveryFacts, ...of("acknowledgement"), ...of("communication").filter((c) => c.from === "buyer")]);
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
    }
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      ok({ id: "description", label: "What was promised: listing, product description or contract", required: true,
        detail: "PayPal accepts a product description, item URL, return policy, contract or affidavit." },
        [...of("description"), ...of("policy").filter((p) => p.policy === "terms")]);
      ok({ id: "rec-delivered", label: "What was delivered (delivery record)", required: false, detail: "Shows the buyer received what was described." }, [...deliveryFacts, ...trackingFacts]);
      ok({ id: "rec-policy", label: "Return or refund policy", required: false, detail: "Shows the buyer's options were clear." }, of("policy").filter((p) => p.policy === "return" || p.policy === "refund"));
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
    }
    case "CREDIT_NOT_PROCESSED":
      ok({ id: "no-credit", label: "Why no credit is due (refund/return policy or the buyer's agreement)", required: true, detail: "PayPal accepts documents such as a credit due reason." },
        [...of("policy").filter((p) => p.policy === "return" || p.policy === "refund"), ...of("acknowledgement")]);
      ok({ id: "rec-comms", label: "Messages with the buyer", required: false, detail: "Shows what was agreed." }, of("communication"));
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
    case "DUPLICATE_TRANSACTION":
    case "PAYMENT_BY_OTHER_MEANS": {
      const inv = of("invoice").filter((f) => sameOrder(refOf(f), d.transaction) === true);
      ok({ id: "distinct-order", label: "Invoice tying this payment to its own order", required: true,
        detail: d.reason === "DUPLICATE_TRANSACTION" ? "Shows this payment was for a separate order, not a repeat." : "Shows this payment, not another one, paid for the order." }, inv);
      ok({ id: "rec-comms", label: "Messages with the buyer", required: false, detail: "Supports the invoice." }, of("communication"));
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
    }
    case "INCORRECT_AMOUNT": {
      const inv = of("invoice").filter((f) => f.amount && f.amount.currency === d.transaction.amount.currency && Math.abs(money(f.amount) - money(d.transaction.amount)) <= 1);
      ok({ id: "agreed-amount", label: "Invoice or quote showing the amount the buyer agreed to", required: true, detail: "Must match what PayPal charged." }, inv);
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
    }
    case "CANCELED_RECURRING_BILLING":
      ok({ id: "subscription-terms", label: "Subscription or cancellation terms", required: true, detail: "PayPal gives the subscription agreement as an example." },
        of("policy").filter((p) => p.policy === "subscription" || p.policy === "cancellation" || p.policy === "terms"));
      ok({ id: "rec-comms", label: "Messages showing no cancellation before the charge", required: false, detail: "" }, of("communication"));
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
    default:
      ok({ id: "any-doc", label: "A document supporting your side", required: true, detail: "PayPal accepts notes or documents." },
        [...of("invoice"), ...of("description"), ...of("policy"), ...of("communication"), ...deliveryFacts]);
      return { type: "OTHER" as EvidenceType, checks, used, tracking };
  }
}

function trackingInfo(f: Extract<Fact, { kind: "tracking" }>) {
  const known = ["UPS", "USPS", "FEDEX", "DHL"];
  const c = f.carrier.trim().toUpperCase().replace(/\s+/g, "_");
  return known.includes(c) ? { carrier_name: c, tracking_number: f.trackingNumber } : { carrier_name: "OTHER", carrier_name_other: f.carrier.trim(), tracking_number: f.trackingNumber };
}

/** The citation helper the UI and the statement guard share. */
export const citeLabel = (c: Cite) => `${c.docId}${c.page ? ` p.${c.page}` : ""}`;
