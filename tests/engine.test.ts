import { describe, expect, it } from "vitest";
import { planPack, sameBuyer, sameOrder, type EngineInput } from "../src/rules/engine";
import type { DisputeCase, EvidenceDoc, Fact } from "../src/types";

const dispute = (o: Partial<DisputeCase> = {}): DisputeCase => ({
  id: "PP-R-TEST-1",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  stage: "INQUIRY",
  status: "WAITING_FOR_SELLER_RESPONSE",
  amount: { value: "120.00", currency: "USD" },
  createTime: "2026-11-05T16:17:05Z",
  sellerResponseDue: "2026-11-25T16:17:05Z",
  actions: ["self", "provide_evidence", "accept_claim", "make_offer", "send_message"],
  transaction: { id: "4JJ59706F4419253F", invoiceId: "INV-1042", createTime: "2026-11-05T16:05:00Z", amount: { value: "120.00", currency: "USD" }, buyerName: "John Doe", buyerEmail: "buyer@personal.example.com" },
  ...o,
});
const doc = (id: string, o: Partial<EvidenceDoc> = {}): EvidenceDoc => ({ id, name: `${id}.pdf`, mime: "application/pdf", bytes: 20_000, sha256: "x", ...o });
const cite = (docId: string, quote = "…") => ({ docId, quote });
const NOW = "2026-11-06T09:00:00Z";
const run = (o: Partial<EngineInput> & { facts: Fact[] }) => planPack({ dispute: dispute(), docs: [doc("delivery-log"), doc("tracking"), doc("invoice"), doc("listing"), doc("refund-email")], now: NOW, ...o });

describe("matching evidence to the payment", () => {
  const tx = dispute().transaction;
  it("matches order references ignoring case, spaces, dashes and #", () => {
    expect(sameOrder("#inv 1042", tx)).toBe(true);
    expect(sameOrder("4JJ59706F4419253F", tx)).toBe(true);
    expect(sameOrder("INV-1043", tx)).toBe(false);
    expect(sameOrder(undefined, tx)).toBeUndefined();
  });
  it("matches the buyer by email or by name", () => {
    expect(sameBuyer("Delivered to John Doe", tx)).toBe(true);
    expect(sameBuyer("buyer@personal.example.com", tx)).toBe(true);
    expect(sameBuyer("Jane Smith", tx)).toBe(false);
    expect(sameBuyer(undefined, tx)).toBeUndefined();
  });
});

describe("item not received", () => {
  it("a dated digital delivery record for this order is enough: READY, no invented tracking number", () => {
    const p = run({ facts: [{ id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "download link opened", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.verdict).toBe("READY");
    expect(p.evidenceType).toBe("PROOF_OF_FULFILLMENT");
    expect(p.evidenceInfo.tracking_info).toBeUndefined();
    expect(p.documentIds).toEqual(["delivery-log"]);
    expect(p.canFileNow).toBe(true);
  });
  it("uses the carrier's own code when PayPal knows the carrier", () => {
    const p = run({ facts: [{ id: "f1", kind: "tracking", carrier: "usps", trackingNumber: "9400 1000 0000 0000 0000 00", status: "delivered", at: "2026-11-04T10:00:00Z", recipient: "John Doe", cite: cite("tracking") }] });
    expect(p.verdict).toBe("READY");
    expect(p.evidenceInfo.tracking_info).toEqual([{ carrier_name: "USPS", tracking_number: "9400 1000 0000 0000 0000 00" }]);
  });
  it("other carriers go in carrier_name_other", () => {
    const p = run({ facts: [{ id: "f1", kind: "tracking", carrier: "Mauritius Post", trackingNumber: "RR123456789MU", status: "delivered", at: "2026-11-04T10:00:00Z", orderRef: "INV-1042", cite: cite("tracking") }] });
    expect(p.evidenceInfo.tracking_info).toEqual([{ carrier_name: "OTHER", carrier_name_other: "Mauritius Post", tracking_number: "RR123456789MU" }]);
  });
  it("with no evidence, says refunding is likely cheaper and names PayPal's options", () => {
    const p = run({ facts: [] });
    expect(p.verdict).toBe("NO_DEFENCE");
    expect(p.suggestion).toMatch(/make an offer or accept the claim/);
  });
  it("tracking for a different order is set aside, never filed", () => {
    const p = run({ facts: [{ id: "f1", kind: "tracking", carrier: "UPS", trackingNumber: "1Z999", status: "delivered", orderRef: "INV-9999", cite: cite("tracking") }] });
    expect(p.verdict).toBe("NO_DEFENCE");
    expect(p.evidenceInfo.tracking_info).toBeUndefined();
    expect(p.checks.find((c) => c.id === "foreign-f1")?.status).toBe("warn");
  });
  it("same order but delivered to someone else is a contradiction: CONFLICT", () => {
    const p = run({ facts: [{ id: "f1", kind: "tracking", carrier: "UPS", trackingNumber: "1Z999", status: "delivered", orderRef: "INV-1042", recipient: "Jane Smith", cite: cite("tracking") }] });
    expect(p.verdict).toBe("CONFLICT");
  });
  it("a shipment without confirmed delivery is still filable but scores lower", () => {
    const delivered = run({ facts: [{ id: "f1", kind: "tracking", carrier: "UPS", trackingNumber: "1Z1", status: "delivered", at: "2026-11-04T00:00:00Z", orderRef: "INV-1042", cite: cite("tracking") }] });
    const shipped = run({ facts: [{ id: "f1", kind: "tracking", carrier: "UPS", trackingNumber: "1Z1", status: "shipped", orderRef: "INV-1042", cite: cite("tracking") }] });
    expect(shipped.verdict).toBe("READY");
    expect(shipped.completeness).toBeLessThan(delivered.completeness);
  });
  it("warns when delivery is dated after the dispute opened", () => {
    const p = run({ facts: [{ id: "f1", kind: "delivery", method: "physical", at: "2026-11-06T08:00:00Z", detail: "left at door", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.verdict).toBe("READY");
    expect(p.checks.some((c) => c.id === "late-f1" && c.status === "warn")).toBe(true);
  });
});

describe("checks against PayPal's own records", () => {
  it("an invoice for a different amount than PayPal charged blocks filing", () => {
    const p = run({ facts: [
      { id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") },
      { id: "f2", kind: "invoice", orderRef: "INV-1042", amount: { value: "150.00", currency: "USD" }, cite: cite("invoice") },
    ] });
    expect(p.verdict).toBe("CONFLICT");
    expect(p.reasons.join(" ")).toMatch(/amount/i);
  });
  it("a refund ID PayPal does not know blocks filing", () => {
    const p = run({ facts: [
      { id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") },
      { id: "f2", kind: "refund", refundId: "FAKE123", cite: cite("refund-email") },
    ] });
    expect(p.verdict).toBe("CONFLICT");
  });
  it("a full refund PayPal confirms is filed as PROOF_OF_REFUND with PayPal's refund IDs", () => {
    const p = run({ facts: [{ id: "f2", kind: "refund", refundId: "R-1", cite: cite("refund-email") }],
      verifiedRefunds: [{ id: "R-1", captureId: "4JJ59706F4419253F", amount: { value: "120.00", currency: "USD" }, status: "COMPLETED" }] });
    expect(p.verdict).toBe("READY");
    expect(p.evidenceType).toBe("PROOF_OF_REFUND");
    expect(p.evidenceInfo.refund_ids).toEqual(["R-1"]);
  });
  it("a refund on another payment does not count", () => {
    const p = run({ facts: [], verifiedRefunds: [{ id: "R-9", captureId: "OTHER", amount: { value: "120.00", currency: "USD" }, status: "COMPLETED" }] });
    expect(p.evidenceType).not.toBe("PROOF_OF_REFUND");
  });
  it("a missed deadline blocks filing", () => {
    const p = planPack({ dispute: dispute({ sellerResponseDue: "2026-11-01T00:00:00Z" }), docs: [doc("delivery-log")], now: NOW,
      facts: [{ id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.verdict).toBe("CONFLICT");
  });
  it("is READY but not filable when PayPal does not offer provide_evidence", () => {
    const p = planPack({ dispute: dispute({ actions: ["self", "accept_claim"] }), docs: [doc("delivery-log")], now: NOW,
      facts: [{ id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.verdict).toBe("READY");
    expect(p.canFileNow).toBe(false);
  });
});

describe("documents", () => {
  it("never uses facts from a document with instructions aimed at an AI", () => {
    const p = planPack({ dispute: dispute(), docs: [doc("delivery-log", { quarantined: true })], now: NOW,
      facts: [{ id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.verdict).toBe("NO_DEFENCE");
    expect(p.checks.find((c) => c.id === "quarantine")).toBeTruthy();
  });
  it("does not attach file types PayPal refuses (they go into the summary PDF)", () => {
    const p = planPack({ dispute: dispute(), docs: [doc("chat", { name: "chat.txt", mime: "text/plain" })], now: NOW,
      facts: [{ id: "f1", kind: "acknowledgement", at: "2026-11-05T17:00:00Z", text: "Got the files, thanks!", cite: cite("chat") }] });
    expect(p.verdict).toBe("READY");
    expect(p.documentIds).toEqual([]);
    expect(p.checks.some((c) => c.id === "type-chat")).toBe(true);
  });
  it("does not attach files of 10 MB or more", () => {
    const p = planPack({ dispute: dispute(), docs: [doc("delivery-log", { bytes: 11 * 1024 * 1024 })], now: NOW,
      facts: [{ id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.documentIds).toEqual([]);
  });
});

describe("other reasons", () => {
  it("not as described needs what was promised", () => {
    const base = { dispute: dispute({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" }), docs: [doc("listing"), doc("delivery-log")], now: NOW };
    const withListing = planPack({ ...base, facts: [{ id: "f1", kind: "description", text: "3 logo concepts, vector files", cite: cite("listing") }] });
    const onlyDelivery = planPack({ ...base, facts: [{ id: "f2", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(withListing.verdict).toBe("READY");
    expect(withListing.evidenceType).toBe("OTHER");
    expect(onlyDelivery.verdict).toBe("INCOMPLETE");
    expect(onlyDelivery.reasons.join(" ")).toMatch(/promised/);
  });
  it("incorrect amount: an invoice matching the charge is the defence; a partial refund PayPal confirms is filed as a refund", () => {
    const d = dispute({ reason: "INCORRECT_AMOUNT" });
    const inv = planPack({ dispute: d, docs: [doc("invoice")], now: NOW, facts: [{ id: "f1", kind: "invoice", orderRef: "INV-1042", amount: { value: "120.00", currency: "USD" }, cite: cite("invoice") }] });
    expect(inv.verdict).toBe("READY");
    const part = planPack({ dispute: d, docs: [], now: NOW, facts: [], verifiedRefunds: [{ id: "R-2", captureId: "4JJ59706F4419253F", amount: { value: "20.00", currency: "USD" }, status: "COMPLETED" }] });
    expect(part.evidenceType).toBe("PROOF_OF_REFUND");
  });
  it("unauthorised with tracking to the account holder is fulfilment; without tracking it falls back to OTHER", () => {
    const d = dispute({ reason: "UNAUTHORISED" });
    const tr = planPack({ dispute: d, docs: [doc("tracking")], now: NOW, facts: [{ id: "f1", kind: "tracking", carrier: "DHL", trackingNumber: "JD01", status: "delivered", recipient: "John Doe", cite: cite("tracking") }] });
    expect(tr.evidenceType).toBe("PROOF_OF_FULFILLMENT");
    const ack = planPack({ dispute: d, docs: [doc("chat")], now: NOW, facts: [{ id: "f1", kind: "acknowledgement", text: "Thanks, got it", cite: cite("chat") }] });
    expect(ack.evidenceType).toBe("OTHER");
    expect(ack.verdict).toBe("READY");
  });
  it("cancelled subscription needs the subscription terms", () => {
    const p = planPack({ dispute: dispute({ reason: "CANCELED_RECURRING_BILLING" }), docs: [doc("listing")], now: NOW,
      facts: [{ id: "f1", kind: "policy", policy: "subscription", text: "Cancel any time before the renewal date", cite: cite("listing") }] });
    expect(p.verdict).toBe("READY");
  });
});

describe("when PayPal has no invoice number for the payment", () => {
  const noInv = dispute({ transaction: { ...dispute().transaction, invoiceId: undefined } });
  it("the seller's own order number is neither confirmed nor refuted, so the evidence is kept", () => {
    const p = planPack({ dispute: noInv, docs: [doc("delivery-log")], now: NOW,
      facts: [{ id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "sent", orderRef: "INV-1042", cite: cite("delivery-log") }] });
    expect(p.verdict).toBe("READY");
    expect(p.checks.find((c) => c.id === "rec-linked")?.detail).toMatch(/no invoice number/);
  });
  it("a different PayPal transaction ID is still a different order", () => {
    expect(sameOrder("9XX11111A2222333B", noInv.transaction)).toBe(false);
  });
});

describe("supporting documents", () => {
  it("attaches the invoice for this order alongside the delivery proof, but not an invoice for another order", () => {
    const p = planPack({ dispute: dispute(), docs: [doc("delivery-log"), doc("invoice"), doc("other-invoice")], now: NOW, facts: [
      { id: "f1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "downloaded", orderRef: "INV-1042", cite: cite("delivery-log") },
      { id: "f2", kind: "invoice", orderRef: "INV-1042", amount: { value: "120.00", currency: "USD" }, cite: cite("invoice") },
      { id: "f3", kind: "invoice", orderRef: "INV-7777", cite: cite("other-invoice") },
    ] });
    expect(p.verdict).toBe("READY");
    expect(p.documentIds).toEqual(["delivery-log", "invoice"]);
    expect(p.checks.find((c) => c.id === "rec-what-sold")?.status).toBe("ok");
  });
});
