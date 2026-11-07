// Demo mode must show exactly what the published evaluation scored, and its stand-in PayPal must refuse what the
// real API refuses. Runs the same seed the demo server uses, into a temporary store.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEMO_NOW, DemoPayPal, isDemoRefusal, savedDraft, seedDemo } from "../src/demo/demo";
import { aliasUsed } from "../src/ai/drafter";
import { buildCase, engineDoc } from "../src/case";
import { evidenceForm, evidenceInput } from "../src/paypal/evidence";
import type { PayPal } from "../src/paypal/client";
import { checkStatement } from "../src/rules/statement";
import { Store } from "../src/store";

const ROOT = join(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "claimpack-demo-"));
const store = new Store(join(dir, "demo.db"));
const pp = new DemoPayPal();
const caseOf = await seedDemo(ROOT, store, pp, dir);
const build = (id: string) => buildCase(store, pp as unknown as PayPal, id, { now: DEMO_NOW });
afterAll(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });

describe("demo mode (npm run demo)", () => {
  it("loads all 30 evaluation disputes and gives each its expected verdict", async () => {
    expect(caseOf.size).toBe(30);
    for (const [disputeId, cid] of caseOf) {
      const gold = JSON.parse(readFileSync(join(ROOT, "eval", "cases", cid, "case.json"), "utf8")).gold;
      expect((await build(disputeId)).plan.verdict, cid).toBe(gold.verdict);
    }
  });

  it("every saved statement for a ready case passes the guard as the app numbers the facts", async () => {
    let checked = 0;
    for (const [disputeId, cid] of caseOf) {
      const kase = await build(disputeId);
      if (kase.plan.verdict !== "READY") continue;
      const statement = savedDraft(ROOT, cid);
      expect(statement, cid).toBeTruthy();
      const alias = aliasUsed(kase.facts, kase.plan);
      const check = checkStatement(statement!, alias, alias.map((f) => f.id), kase.dispute, store.docs(kase.dispute.transaction.id).map(engineDoc));
      expect(check.problems, cid).toEqual([]);
      checked++;
    }
    expect(checked).toBe(16);
  });

  it("the stand-in PayPal accepts a well-formed filing once, then stops offering provide_evidence", async () => {
    const id = [...caseOf].find(([, c]) => c === "c01")![0];
    const kase = await build(id);
    const files = [{ name: "evidence-summary.pdf", mime: "application/pdf", data: new Uint8Array([37, 80, 68, 70]) as Uint8Array<ArrayBuffer> }];
    const input = evidenceInput(kase.plan, "Statement.", files);
    await pp.provideEvidence(id, evidenceForm(input, files));
    const after = await pp.getDispute(id);
    expect(after.status).toBe("WAITING_FOR_BUYER_RESPONSE");
    expect(after.links.map((l: { rel: string }) => l.rel)).not.toContain("provide_evidence");
    await expect(pp.provideEvidence(id, evidenceForm(input, files))).rejects.toSatisfy(isDemoRefusal);
  });

  it("refuses a file type PayPal does not accept", async () => {
    const id = [...caseOf].find(([, c]) => c === "c13")![0];
    const fd = new FormData();
    fd.append("input", new Blob([JSON.stringify({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", documents: [{ name: "notes.txt" }] }] })], { type: "application/json" }), "input.json");
    fd.append("file1", new Blob(["hello"], { type: "text/plain" }), "notes.txt");
    await expect(pp.provideEvidence(id, fd)).rejects.toSatisfy(isDemoRefusal);
  });
});
