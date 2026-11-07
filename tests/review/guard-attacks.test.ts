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
import { checkStatement } from "../../src/rules/statement";
const facts: Fact[] = [{ id:"F1",kind:"delivery",method:"digital",at:"2026-11-05T16:07:00Z",detail:"one file link opened",orderRef:"INV-1042",cite:cite("INV-1042: one file link opened 2026-11-05T16:07:00Z; size 120 bytes") }];
const holes: [string,string][] = [
 ["G01 spelled-out number", "The buyer downloaded the files five times [F1]."],
 ["G02 percentage changes unit of existing number", "The buyer approved 120% of the work [F1]."],
 ["G03 relative date", "The buyer received the files the next day [F1]."],
 ["G04 unsupported satisfaction", "The buyer confirmed satisfaction [F1]."],
 ["G05 units changed", "The package weighed 120 kilograms [F1]."],
 ["G06 currency changed", "The buyer agreed to pay €120.00 [F1]."],
 ["G07 invented name", "Alice Smith personally accepted the work [F1]."],
 ["G08 fabricated buyer quotation", 'The buyer wrote "I received everything and waive my claim" [F1].'],
 ["G09 unicode look-alike digits", "The buyer downloaded ９９９ copies [F1]."],
 ["G10 unclosed quote swallows uncited sentence", 'The record says "link opened [F1]. The buyer accepted every deliverable.'],
 ["G11 unclosed parenthesis swallows uncited sentence", "The link opened (see record [F1]. The buyer withdrew the dispute."],
 ["G12 reused date components create new quantity", "The buyer downloaded 2026 copies [F1]."],
 ["G13 negation reversed", "The buyer never reported any problem [F1]."],
];
describe("adversarial guard rejection contracts (expected red before fixes)",()=>{
 for(const [name,text] of holes) it(name,()=>{const c=checkStatement(text,facts,["F1"],dispute,docs); console.log(name,JSON.stringify(c));expect(c.ok).toBe(false);});
});
describe("held guard defences",()=>{
 it("rejects uncited text",()=>expect(checkStatement("The buyer was satisfied.",facts,["F1"],dispute,docs).ok).toBe(false));
 it("rejects unknown ASCII number",()=>expect(checkStatement("Downloaded 98765 copies [F1].",facts,["F1"],dispute,docs).ok).toBe(false));
 it("rejects foreign fact ID",()=>expect(checkStatement("Opened [F9].",facts,["F1"],dispute,docs).ok).toBe(false));
 it("rejects unsupported URL",()=>expect(checkStatement("See https://invented.invalid [F1].",facts,["F1"],dispute,docs).ok).toBe(false));
});
