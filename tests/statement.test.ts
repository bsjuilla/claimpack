import { describe, expect, it } from "vitest";
import { checkStatement } from "../src/rules/statement";
import { evidenceInput } from "../src/paypal/evidence";
import type { DisputeCase, Fact, PackPlan } from "../src/types";

const dispute: DisputeCase = {
  id: "PP-R-TEST-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", stage: "INQUIRY", status: "WAITING_FOR_SELLER_RESPONSE",
  amount: { value: "120.00", currency: "USD" }, createTime: "2026-11-05T16:17:05Z", actions: ["provide_evidence"],
  transaction: { id: "4JJ59706F4419253F", invoiceId: "INV-1042", createTime: "2026-11-05T16:05:00Z", amount: { value: "120.00", currency: "USD" } },
};
const facts: Fact[] = [
  { id: "F1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "Buyer downloaded logo-final.zip twice", orderRef: "INV-1042",
    cite: { docId: "d1", quote: "05 Nov 2026 16:07 UTC  INV-1042  logo-final.zip downloaded (2 times)" } },
  { id: "F2", kind: "description", text: "3 logo concepts in vector format", cite: { docId: "d2", quote: "Package: 3 logo concepts, vector (AI, SVG)" } },
];
const docs = [{ id: "d1", name: "delivery-log.pdf", mime: "application/pdf", bytes: 1, sha256: "" }, { id: "d2", name: "listing.pdf", mime: "application/pdf", bytes: 1, sha256: "" }];
const check = (s: string, used = ["F1", "F2"]) => checkStatement(s, facts, used, dispute, docs);

describe("statement guard", () => {
  it("passes a statement where every sentence cites a used fact and every number is in the documents", () => {
    const r = check("Order INV-1042 was delivered by download on 05 Nov 2026 at 16:07 UTC [F1]. The buyer downloaded the files 2 times [F1]. The order was 3 logo concepts in vector format [F2].");
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.notes).toBe("Order INV-1042 was delivered by download on 05 Nov 2026 at 16:07 UTC (see delivery-log.pdf). The buyer downloaded the files 2 times (see delivery-log.pdf). The order was 3 logo concepts in vector format (see listing.pdf).");
  });
  it("rejects a sentence with no citation", () => {
    expect(check("The buyer received the files [F1]. We always deliver on time.").problems.map((p) => p.problem)).toContain("cites no document");
  });
  it("rejects a number the documents do not contain (the model must not invent detail)", () => {
    const r = check("The buyer downloaded the files 5 times [F1].");
    expect(r.ok).toBe(false);
    expect(r.problems[0].problem).toMatch(/"5"/);
  });
  it("rejects a citation to a fact the engine did not use for this pack", () => {
    expect(check("The order was 3 logo concepts [F2].", ["F1"]).problems[0].problem).toMatch(/not part of this evidence pack/);
  });
  it("rejects links and emails that are not in the documents", () => {
    expect(check("Files are at https://evil.example/x [F1].").ok).toBe(false);
  });
  it("rejects accusations against the buyer", () => {
    expect(check("The buyer is lying about delivery on 05 Nov 2026 [F1].").problems.map((p) => p.problem)).toContain("accuses the buyer; state facts only");
  });
  it("allows PayPal's own numbers (amount, transaction id) when a fact is cited", () => {
    expect(check("Payment 4JJ59706F4419253F for 120.00 USD was for order INV-1042 [F1].").ok).toBe(true);
  });
});

describe("provide-evidence request", () => {
  const plan: PackPlan = { verdict: "READY", evidenceType: "PROOF_OF_FULFILLMENT", evidenceInfo: {}, usedFactIds: ["F1"], documentIds: ["d1"], checks: [], completeness: 100, canFileNow: true, reasons: [], evidenceFingerprint: "x", protection: { level: "NOT_ASSESSED", reasons: [] } };
  it("matches the shape the sandbox accepted, with no tracking info invented", () => {
    const input = evidenceInput(plan, "Delivered (see delivery-log.pdf).", [{ name: "delivery-log.pdf", mime: "application/pdf", data: new Uint8Array() }]);
    expect(input).toEqual({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: {}, documents: [{ name: "delivery-log.pdf" }], notes: "Delivered (see delivery-log.pdf)." }] });
  });
  it("refuses to build a filing for a pack that is not READY", () => {
    expect(() => evidenceInput({ ...plan, verdict: "INCOMPLETE" }, "x", [])).toThrow(/INCOMPLETE/);
  });
});

describe("statement guard: dates and counts", () => {
  it("accepts '5 November 2026' for a document that says '05 Nov 2026'", () => {
    expect(check("The files were downloaded on 5 November 2026 [F1].").ok).toBe(true);
  });
  it("does not let a count borrow the day of a date", () => {
    expect(check("The files were downloaded 5 times on 05 Nov 2026 [F1].").ok).toBe(false);
  });
});

describe("statement guard: quotes, months and times", () => {
  const fx: Fact[] = [{ id: "F1", kind: "acknowledgement", at: "2026-11-05T18:02:00Z", text: "Got the files, thanks! The second concept is perfect.",
    cite: { docId: "d1", quote: "2026-11-05 18:02 UTC  Client email: \"Got the files, thanks! The second concept is perfect.\"" } }];
  const c = (s: string) => checkStatement(s, fx, ["F1"], dispute, docs);
  it("does not split a sentence inside a quotation", () => {
    const r = c('The buyer wrote "Got the files, thanks! The second concept is perfect." [F1].');
    expect(r.problems).toEqual([]);
  });
  it("checks the month, not just the day and year", () => {
    expect(c("The buyer confirmed receipt on 5 November 2026 at 18:02 UTC [F1].").ok).toBe(true);
    expect(c("The buyer confirmed receipt on 5 October 2026 [F1].").ok).toBe(false);
    expect(c("The buyer confirmed receipt on November 5, 2026 [F1].").ok).toBe(true);
  });
  it("accepts 18:02 for a record time of 18:02:00, but not a different time", () => {
    expect(c("The buyer replied at 18:02 UTC on 5 November 2026 [F1].").ok).toBe(true);
    expect(c("The buyer replied at 18:20 UTC on 5 November 2026 [F1].").ok).toBe(false);
  });
});

describe("sentence splitting", () => {
  it("keeps decimals, emails and file names whole, and keeps trailing citations with their sentence", async () => {
    const { sentences } = await import("../src/rules/statement");
    expect(sentences("A 14.2 MB file went to a@shop.example.com at 16:05 [F1]. logo-final.zip was downloaded (2 of 2) [F2]. The buyer wrote \"Thanks! Perfect.\" [F3]."))
      .toEqual(["A 14.2 MB file went to a@shop.example.com at 16:05 [F1].", "logo-final.zip was downloaded (2 of 2) [F2].", "The buyer wrote \"Thanks! Perfect.\" [F3]."]);
    expect(sentences("Sent e.g. by email. [F1] Then opened [F2].")).toEqual(["Sent e.g. by email. [F1]", "Then opened [F2]."]);
  });
});

describe("statement guard: internal ids never vouch for numbers", () => {
  it("a digit inside the document's internal id does not support a number in the statement", () => {
    const fx: Fact[] = [{ id: "F1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "downloaded",
      cite: { docId: "d0975f4d53be9", quote: "2026-11-05 16:07 UTC logo-final.zip downloaded (1 of 2)" } }];
    const r = checkStatement("The files were downloaded 9 times [F1].", fx, ["F1"], dispute, [{ id: "d0975f4d53be9", name: "log.pdf", mime: "application/pdf", bytes: 1, sha256: "" }]);
    expect(r.ok).toBe(false);
    expect(r.problems[0].problem).toMatch(/"9"/);
  });
});
