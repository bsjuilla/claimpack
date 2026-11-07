import { describe, expect, it } from "vitest";
import type { DisputeCase, EvidenceDoc, Fact } from "../../src/types";
const dispute: DisputeCase = {
 id: "PP-R-ADVERSARY", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", stage: "CHARGEBACK",
 status: "WAITING_FOR_SELLER_RESPONSE", amount: { value: "120.00", currency: "USD" },
 createTime: "2026-11-06T12:00:00Z", sellerResponseDue: "2026-11-25T12:00:00Z", actions: ["provide_evidence"],
 transaction: { id: "4JJ59706F4419253F", invoiceId: "INV-1042", createTime: "2026-11-05T16:05:00Z",
 amount: { value: "120.00", currency: "USD" }, buyerName: "John Michael Doe", buyerEmail: "buyer@example.com" }
};
const docs: EvidenceDoc[] = [{ id: "d1", name: "evidence.pdf", mime: "application/pdf", bytes: 1000, sha256: "fixture" }];
const cite = (quote: string) => ({ docId: "d1", quote });
import { planPack, type EngineInput } from "../../src/rules/engine";
const delivery: Fact = { id: "F1", kind: "delivery", method: "digital", at: "2026-11-05T16:07:00Z", detail: "link opened", orderRef: "INV-1042", recipient: "buyer@example.com", cite: cite("INV-1042 link opened 2026-11-05 16:07 buyer@example.com") };
const tracking: Fact = { id: "F1", kind: "tracking", carrier: "UPS", trackingNumber: "1Z-FIXTURE", status: "delivered", at: "2026-11-05T18:00:00Z", orderRef: "INV-1042", recipient: "John Michael Doe", cite: cite("INV-1042 delivered to John Michael Doe, 99 Wrong Street, Wrong City 99999") };
const run = (facts: Fact[], extra: Partial<EngineInput> = {}) => planPack({ dispute, docs, facts, now: "2026-11-07T09:00:00Z", ...extra });
const holes: [string, Fact[], Partial<EngineInput>?][] = [
 ["E03 near-miss buyer John Michael Roe shares two tokens", [delivery, {id:"F2",kind:"invoice",orderRef:"INV-1042",buyer:"John Michael Roe",amount:{value:"120.00",currency:"USD"},cite:cite("INV-1042 John Michael Roe 120.00 USD")}]],
 ["E06 shipment alone is not proof of receipt", [{...tracking,status:"shipped",at:undefined,cite:cite("INV-1042 label created; UPS 1Z-FIXTURE")}]],
 ["E07 invalid nonempty delivery date still qualifies", [{...delivery,at:"not-a-date"}]],
 ["E08 same-order invoice malformed money NaN evades conflict", [delivery,{id:"F2",kind:"invoice",orderRef:"INV-1042",amount:{value:"120.00.99",currency:"USD"},cite:cite("INV-1042 amount 120.00.99 USD")}]],
 ["E10 duplicate verified refund IDs double count a partial refund", [],{verifiedRefunds:[1,2].map(()=>({id:"R-SAME",captureId:dispute.transaction.id,amount:{value:"60.00",currency:"USD"},status:"COMPLETED"}))}],
 ["E11 mismatched refund currency counts at face value", [],{verifiedRefunds:[{id:"R-EUR",captureId:dispute.transaction.id,amount:{value:"120.00",currency:"EUR"},status:"COMPLETED"}]}],
 ["E12 negative delivery event still qualifies", [{...delivery,detail:"download failed; buyer never accessed files",cite:cite("INV-1042 2026-11-05 download failed; buyer never accessed files")}]],
];
describe("adversarial engine rejection contracts (expected red before fixes)",()=>{
 for(const [name,facts,extra] of holes) it(name,()=>{const p=run(facts,extra); console.log(name, JSON.stringify({verdict:p.verdict,type:p.evidenceType,checks:p.checks})); expect(p.verdict).not.toBe("READY");});
});
describe("held engine defences",()=>{
 it("H01 wrong-payment refund is rejected",()=>{const p=run([{id:"F2",kind:"refund",refundId:"8AB12345678901234",cite:cite("refund 8AB12345678901234")}],{verifiedRefunds:[{id:"8AB12345678901234",captureId:"OTHERPAYMENT",amount:{value:"120.00",currency:"USD"},status:"COMPLETED"}]});expect(p.verdict).toBe("CONFLICT");});
 it("H02 amount mismatch blocks",()=>expect(run([delivery,{id:"F2",kind:"invoice",orderRef:"INV-1042",amount:{value:"121.00",currency:"USD"},cite:cite("INV-1042 121.00 USD")}]).verdict).toBe("CONFLICT"));
 it("H03 disallowed reason/type: delivery alone cannot defend SNAD",()=>expect(run([delivery],{dispute:{...dispute,reason:"MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"}}).verdict).not.toBe("READY"));
 it("H04 explicit different order discarded",()=>expect(run([{...tracking,orderRef:"INV-9999"}]).verdict).toBe("NO_DEFENCE"));
 it("H05 quarantine blocks all otherwise valid facts",()=>expect(run([delivery],{docs:[{...docs[0],quarantined:true}]}).verdict).toBe("NO_DEFENCE"));
 it("H06 different full buyer name blocks same-order evidence",()=>expect(run([{...tracking,recipient:"Jane Smith"}]).verdict).toBe("CONFLICT"));
});

// Adapted 7 Nov 2026 by the builder. These four asked ClaimPack to refuse evidence it cannot check: a seller's own log
// cannot be proven genuine, and PayPal's shipping address is not in the dispute record. PayPal's API still accepts such
// evidence, so ClaimPack keeps them filable and says plainly what it could not check (the Seller Protection tier).
describe("adapted: what ClaimPack cannot verify is said, not hidden", () => {
  it("E01 a seller's own log is filable, and the plan says the documents are the seller's own, not verified", () => {
    const p = run([delivery]);
    expect(p.protection.reasons.join(" ")).toMatch(/not whether they are genuine/);
  });
  it("E02 tracking to the right buyer: protection notes the delivery address is not compared", () => {
    const p = run([tracking]);
    expect(p.protection.reasons.join(" ")).toMatch(/cannot yet compare the delivery address/);
  });
  it("E04 an ambiguous day/month date shows both readings to the seller", () => {
    const p = run([{ ...delivery, at: "", atText: "INV-1042 opened 05/11 16:07", cite: cite("INV-1042 opened 05/11 16:07") } as Fact]);
    const w = p.checks.find((c) => c.id.startsWith("date-"));
    expect(w?.detail).toMatch(/could also be read as/);
  });
  it("E05 a thank-you naming neither buyer nor order is filable, but flagged and not likely to be protected", () => {
    const p = run([{ id: "F1", kind: "acknowledgement", text: "Received it thanks", cite: cite("Received it thanks") } as Fact]);
    expect(p.checks.find((c) => c.id === "rec-linked")?.status).toBe("warn");
    expect(p.protection.level).not.toBe("LIKELY");
  });
  it("E09 a digital delivery naming no recipient and no access is not likely to be protected", () => {
    const p = run([{ ...delivery, recipient: undefined, detail: "seller marked sent", cite: cite("INV-1042 marked sent 2026-11-05") }]);
    expect(p.protection.level).not.toBe("LIKELY");
  });
});
