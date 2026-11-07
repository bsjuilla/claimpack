import { describe, expect, it } from "vitest";
import { toFacts, type ReaderOutput } from "../../src/ai/reader";
// These simulate reader outputs; they do NOT claim the live model produced them.
const row={kind:"delivery",quote:"INV-1042 delivery failed 2026-11-05",page:null,at:"2026-11-05T16:07:00Z",order_ref:"INV-1042",transaction_id:null,carrier:null,tracking_number:null,tracking_status:null,recipient:"buyer@example.com",delivery_method:"digital",detail:"buyer received everything and confirmed satisfaction",refund_id:null,amount_value:null,amount_currency:null,buyer:null,policy:null,from:null};
const output=(facts:any[]):ReaderOutput=>({document_type:"delivery_log",addressed_to_reader:false,addressed_to_reader_quote:null,facts}) as ReaderOutput;
describe("reader defensive output contracts",()=>{
 it("R01 contradictory structured fact must not launder negative quote",()=>{const r=toFacts("d1",output([row]));console.log("R01",JSON.stringify(r));expect(r.facts).toEqual([]);});
 it("R02 invalid delivery date must be rejected at reader boundary",()=>{const r=toFacts("d1",output([{...row,at:"not-a-date"}]));console.log("R02",JSON.stringify(r));expect(r.facts).toEqual([]);});
});
