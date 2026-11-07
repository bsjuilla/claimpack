import { describe, expect, it } from "vitest";
import { checkStatement } from "../../src/rules/statement";
import type { DisputeCase, Fact } from "../../src/types";
const dispute: DisputeCase = { id: "PP-R-TEST-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", stage: "INQUIRY", status: "WAITING_FOR_SELLER_RESPONSE",
  amount: { value: "120.00", currency: "USD" }, createTime: "2026-11-05T16:17:05Z", actions: ["provide_evidence"],
  transaction: { id: "4JJ59706F4419253F", invoiceId: "INV-1042", createTime: "2026-11-05T16:05:00Z", amount: { value: "120.00", currency: "USD" } } };
const facts: Fact[] = [
  { id: "F1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "Buyer downloaded logo-final.zip twice", orderRef: "INV-1042",
    cite: { docId: "d1", quote: "05 Nov 2026 16:07 UTC  INV-1042  logo-final.zip downloaded (2 times)" } },
  { id: "F2", kind: "description", text: "3 logo concepts in vector format", cite: { docId: "d2", quote: "Package: 3 logo concepts, vector (AI, SVG)" } } ];
const docs = [{ id: "d1", name: "delivery-log.pdf", mime: "application/pdf", bytes: 1, sha256: "" }, { id: "d2", name: "listing.pdf", mime: "application/pdf", bytes: 1, sha256: "" }];
const c = (s: string) => checkStatement(s, facts, ["F1","F2"], dispute, docs);
describe("probe", () => {
  it("A number written as a word", () => { expect(c("The buyer downloaded the files five times [F1].").ok).toBe(false); });
  it("B accusation phrased differently", () => { expect(c("The buyer is making a false claim and committing chargeback abuse [F1].").ok).toBe(false); });
  it("C ISO-style date not in docs", () => { expect(c("The files were delivered on 2026/11/09 [F1].").ok).toBe(false); });
  it("D relative date", () => { expect(c("The buyer confirmed receipt yesterday [F1].").ok).toBe(false); });
  it("E month name without year", () => { expect(c("The files were downloaded on 9 November [F1].").ok).toBe(false); });
  it("F unsupported claim cited to listing", () => { expect(c("The buyer signed for the parcel in person [F2].").ok).toBe(false); });
  it("G currency word amount", () => { expect(c("The buyer paid one hundred and fifty dollars [F1].").ok).toBe(false); });
});
