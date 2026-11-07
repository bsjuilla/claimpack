// Suggested tests from REVIEW-3-PAYPAL. Copy into tests/. Each currently FAILS (proves a bug/gap).
import { describe, expect, it } from "vitest";
import { planPack } from "../../src/rules/engine";
import { evidenceInput, evidenceForm, paypalFileNames } from "../../src/paypal/evidence";
import type { DisputeCase, EvidenceDoc } from "../../src/types";

const dispute = (o: Partial<DisputeCase> = {}): DisputeCase => ({
  id: "PP-R-TEST-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", stage: "INQUIRY", status: "WAITING_FOR_SELLER_RESPONSE",
  amount: { value: "120.00", currency: "USD" }, createTime: "2026-11-05T16:17:05Z", sellerResponseDue: "2026-11-25T16:17:05Z",
  actions: ["self", "provide_evidence"],
  transaction: { id: "4JJ59706F4419253F", invoiceId: "INV-1042", createTime: "2026-11-05T16:05:00Z", amount: { value: "120.00", currency: "USD" }, buyerName: "John Doe", buyerEmail: "buyer@personal.example.com" },
  ...o,
});
const doc = (id: string, o: Partial<EvidenceDoc> = {}): EvidenceDoc => ({ id, name: `${id}.pdf`, mime: "application/pdf", bytes: 20_000, sha256: "x", ...o });
const NOW = "2026-11-06T09:00:00Z";

// PayPal spec (paypal-rest-api-specifications customer_disputes_v1.json, schema "document.name"):
const PAYPAL_DOC_NAME = /^[A-Za-z0-9-_,\s]+[.]{1}[A-Za-z]+$/;
// server/index.ts:144 sanitizer, copied verbatim:
// Adapted 7 Nov: names sent to PayPal now come from paypalFileNames (src/paypal/evidence.ts), not the upload sanitiser.
const claimpackSanitize = (n: string) => paypalFileNames([{ name: n }])[0];

describe("review 3: document names PayPal's schema rejects", () => {
  for (const raw of ["receipt (1).pdf", "invoice.v2.pdf", "Screenshot 2026-11-05 at 10.31.22.png"])
    it(`sanitised "${raw}" matches PayPal's document.name pattern`, () => {
      expect(claimpackSanitize(raw)).toMatch(PAYPAL_DOC_NAME);
    });
});

describe("review 3: partial refund on INCORRECT_AMOUNT", () => {
  it("a 0.01 refund against a 20.00 overcharge dispute is not READY as PROOF_OF_REFUND", () => {
    const p = planPack({
      dispute: dispute({ reason: "INCORRECT_AMOUNT", amount: { value: "20.00", currency: "USD" } }),
      docs: [doc("x")], facts: [], now: NOW,
      verifiedRefunds: [{ id: "R1", captureId: "4JJ59706F4419253F", amount: { value: "0.01", currency: "USD" }, status: "COMPLETED" }],
    });
    expect(p.verdict === "READY" && p.evidenceType === "PROOF_OF_REFUND").toBe(false);
  });
});

describe("review 3: refunds in another currency", () => {
  it("a 120 EUR refund does not cover a 120 USD dispute", () => {
    const p = planPack({ dispute: dispute(), docs: [doc("x")], facts: [], now: NOW,
      verifiedRefunds: [{ id: "R1", captureId: "4JJ59706F4419253F", amount: { value: "120.00", currency: "EUR" }, status: "COMPLETED" }] });
    expect(p.evidenceType).not.toBe("PROOF_OF_REFUND");
  });
});

describe("review 3: stage is ignored by the engine", () => {
  it("plan differs between INQUIRY and CHARGEBACK for not-as-described (PayPal asks different things per stage)", () => {
    const f = [{ id: "f1", kind: "description", text: "Blue mug", cite: { docId: "x", quote: "Blue mug" } } as any];
    const a = planPack({ dispute: dispute({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", stage: "INQUIRY" }), docs: [doc("x")], facts: f, now: NOW });
    const b = planPack({ dispute: dispute({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", stage: "CHARGEBACK" }), docs: [doc("x")], facts: f, now: NOW });
    expect(JSON.stringify(b.checks)).not.toEqual(JSON.stringify(a.checks));
  });
});

describe("review 3: duplicate document names in one filing", () => {
  it("two uploads both named invoice.pdf produce distinct documents[].name", () => {
    const plan: any = { verdict: "READY", evidenceType: "OTHER", evidenceInfo: {} };
    const files = [{ name: "invoice.pdf", mime: "application/pdf", data: new Uint8Array(1) }, { name: "invoice.pdf", mime: "application/pdf", data: new Uint8Array(1) }] as any;
    const names = evidenceInput(plan, "n", files).evidences[0].documents!.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("review 3: Seller Protection proof of delivery for item-not-received", () => {
  it("in-transit tracking alone (no delivered status) is not READY at 50%", () => {
    const p = planPack({ dispute: dispute(), docs: [doc("t")], now: NOW,
      facts: [{ id: "f1", kind: "tracking", carrier: "USPS", trackingNumber: "9400100000000000000000", status: "in_transit", orderRef: "INV-1042", cite: { docId: "t", quote: "q" } } as any] });
    // Today: READY, PROOF_OF_FULFILLMENT, completeness 50. Seller Protection (paypal.com/us/legalhub/paypal/seller-protection)
    // needs "Date of delivery and 'delivered' status" for INR. At minimum this should not be READY without a loud warning.
    expect(p.verdict).not.toBe("READY");
  });
});
