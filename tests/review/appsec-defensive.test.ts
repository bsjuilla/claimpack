import { describe, expect, it } from "vitest";
import { PayPal } from "../../src/paypal/client";
import { buildCase, hashPlan } from "../../src/case";
import { planPack } from "../../src/rules/engine";
import { evidenceInput } from "../../src/paypal/evidence";
import type { DisputeCase, EvidenceDoc, Fact } from "../../src/types";
// All PayPal calls are overridden in-memory. No network or running server.
const d: DisputeCase = {id:"PP-R-MOCK",reason:"MERCHANDISE_OR_SERVICE_NOT_RECEIVED",stage:"CHARGEBACK",status:"WAITING_FOR_SELLER_RESPONSE",amount:{value:"120.00",currency:"USD"},createTime:"2026-11-06",actions:["provide_evidence"],transaction:{id:"CAPTURE-A",invoiceId:"INV-1042",createTime:"2026-11-05",amount:{value:"120.00",currency:"USD"}}};
const docs: EvidenceDoc[]=[{id:"d1",name:"log.pdf",mime:"application/pdf",bytes:100,sha256:"original"}];
const fact: Fact={id:"F1",kind:"delivery",method:"digital",at:"2026-11-05T16:07:00Z",orderRef:"INV-1042",detail:"file downloaded",cite:{docId:"d1",quote:"INV-1042 file downloaded"}};
const plan=(f:Fact=fact, ds=docs)=>planPack({dispute:d,docs:ds,facts:[f],now:"2026-11-07"});
class MockPayPal extends PayPal {
 calls:{path:string;json:unknown}[]=[];
 constructor(){super("offline-placeholder","offline-placeholder");}
 override async call<T=any>(_what:string,path:string,init:any={}):Promise<T>{
  this.calls.push({path,json:init.json});
  if(path.includes("/captures/")) return {supplementary_data:{related_ids:{order_id:"ORDER-MULTICAPTURE"}}} as T;
  if(path.includes("/orders/")) return {purchase_units:[{payments:{captures:[{id:"CAPTURE-A",amount:{value:"120.00",currency_code:"USD"}}]}},{payments:{captures:[{id:"CAPTURE-B",amount:{value:"120.00",currency_code:"USD"}}],refunds:[{id:"REFUND-B",status:"COMPLETED",amount:{value:"120.00",currency_code:"USD"}}]}}]} as T;
  return {verification_status:"FAILURE"} as T;
 }
}
describe("defensive appsec contracts (no services)",()=>{
 it("A01 must not attribute another capture's refund to this capture",async()=>{
  const pp=new MockPayPal();const refunds=await pp.refundsForCapture("CAPTURE-A");
  console.log("A01",JSON.stringify({refunds,verdict:planPack({dispute:d,docs:[],facts:[],verifiedRefunds:refunds,now:"2026-11-07"}).verdict}));
  expect(refunds).toEqual([]);
 });
 it("A02 approval digest must bind actual document hashes",()=>{
  const a=hashPlan(plan());const b=hashPlan(plan(fact,[{...docs[0],sha256:"replaced"}]));console.log("A02",{a,b});expect(a).not.toBe(b);
 });
 it("A03 approval digest must bind cited fact content",()=>{
  const a=hashPlan(plan());const b=hashPlan(plan({...fact,detail:"delivery failed",cite:{docId:"d1",quote:"INV-1042 delivery failed"}}));console.log("A03",{a,b});expect(a).not.toBe(b);
 });
 it("A04 fresh build must refetch dispute actions before authorizing filing",async()=>{
  const raw={dispute_id:"PP-R-MOCK",reason:d.reason,dispute_life_cycle_stage:"CHARGEBACK",status:d.status,dispute_amount:{value:"120.00",currency_code:"USD"},create_time:"2026-11-06",links:[{rel:"provide_evidence"}],disputed_transactions:[{seller_transaction_id:"CAPTURE-A",create_time:"2026-11-05",gross_amount:{value:"120.00",currency_code:"USD"}}]};
  let refreshed=0;
  const pp={refundsForCapture:async()=>[],getDispute:async()=>{refreshed++;return {...raw,status:"RESOLVED",links:[]};}};
  const store={dispute:()=>raw,docs:()=>[],payment:()=>undefined,filings:()=>[],settlements:()=>[],upsertDispute:()=>{}};
  await buildCase(store as any,pp as any,"PP-R-MOCK",{fresh:true,now:"2026-11-07"});console.log("A04",{refreshed});expect(refreshed).toBe(1);
 });
 it("A05 multipart builder must reject oversized file before submission",()=>{
  const files=[{name:"oversized.pdf",mime:"application/pdf",data:new Uint8Array(10*1024*1024)}];
  expect(()=>evidenceInput(plan(),"fixture",files)).toThrow();
 });
 it("A06 webhook verification FAILURE must never count as success",async()=>{
  const pp=new MockPayPal();expect(await pp.verifyWebhook({}, {id:"fixture"},"fixture-webhook")).toBe(false);
  expect(pp.calls[0].path).toBe("/v1/notifications/verify-webhook-signature");
 });
});
