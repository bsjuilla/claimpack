// Runs the real pipeline on the evaluation set: Muse Spark reads every document, the rules engine decides, and (with
// DRAFT=1) the drafter writes a statement for each case judged ready, checked by the statement guard. Scores against
// the gold answers in eval/cases/*/case.json. Every reading is saved, so REPLAY=<run> re-scores for free.
// Usage: npx tsx scripts/eval/run.ts                      (live; costs Meta API credit, about 2 cents a document)
//        DRAFT=1 npx tsx scripts/eval/run.ts              (also draft statements)
//        REPLAY=published-2026-11-07 npx tsx scripts/eval/run.ts   (no API calls)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { loadEnv } from "../../src/paypal/client";
import { makeClient, readDocument, toFacts, type ReadResult } from "../../src/ai/reader";
import { draftStatement } from "../../src/ai/drafter";
import { planPack } from "../../src/rules/engine";
import type { EvidenceDoc, Fact, PackPlan } from "../../src/types";
import { EVAL_NOW } from "./cases";

const ROOT = join(import.meta.dirname, "..", "..");
loadEnv(ROOT);
const CASES_DIR = join(ROOT, "eval", "cases");
const REPLAY = process.env.REPLAY;
const RUN = REPLAY ?? process.env.RUN ?? `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;
const RUN_DIR = join(ROOT, "eval", "runs", RUN);
const DRAFT = process.env.DRAFT === "1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const MIME: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg" };
mkdirSync(join(RUN_DIR, "reads"), { recursive: true });

type Saved = Pick<ReadResult, "docId" | "output" | "facts" | "dropped" | "costUsd" | "ms">;
const ai = REPLAY ? null : makeClient();

async function read(caseId: string, name: string): Promise<Saved> {
  const file = join(RUN_DIR, "reads", `${caseId}__${name}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  if (!ai) throw new Error(`REPLAY ${RUN} has no saved reading for ${caseId}/${name}.`);
  const r = await readDocument(ai.client, ai.model, name, join(CASES_DIR, caseId, name));
  const saved: Saved = { docId: r.docId, output: r.output, facts: r.facts, dropped: r.dropped, costUsd: r.costUsd, ms: r.ms };
  writeFileSync(file, JSON.stringify(saved, null, 1));
  return saved;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const ids = readdirSync(CASES_DIR).filter((d) => existsSync(join(CASES_DIR, d, "case.json"))).sort();
const cases = ids.map((id) => JSON.parse(readFileSync(join(CASES_DIR, id, "case.json"), "utf8")));
const jobs = cases.flatMap((c: any) => c.docs.map((d: any) => ({ caseId: c.id, name: d.name })));
console.log(`${REPLAY ? "Replaying" : "Reading"} ${jobs.length} documents in ${cases.length} cases (run ${RUN})…`);
const reads = await pool(jobs, CONCURRENCY, async (j) => {
  try { return { ...j, r: await read(j.caseId, j.name) }; }
  catch (e) { console.error(`  read failed ${j.caseId}/${j.name}: ${(e as Error).message}`); return { ...j, r: null }; }
});

const rows: any[] = [];
let readCost = 0, draftCost = 0;
for (const c of cases) {
  const mine = reads.filter((x) => x.caseId === c.id);
  // The model's raw output is what is saved; turning it into facts is code, re-applied on every run, so a code fix is
  // scored on the same readings without paying for new ones.
  const facts: Fact[] = mine.flatMap((x) => (x.r ? toFacts(x.name, x.r.output).facts : []));
  readCost += mine.reduce((s, x) => s + (x.r?.costUsd ?? 0), 0);
  const docs: EvidenceDoc[] = c.docs.map((d: any) => {
    const r = mine.find((x) => x.name === d.name)?.r;
    const ext = extname(d.name).toLowerCase();
    // As in the app: text documents are sent to PayPal as a PDF copy.
    return { id: d.name, name: d.name, mime: MIME[ext] ?? "application/pdf", bytes: 50_000, sha256: "", quarantined: !!r?.output.addressed_to_reader };
  });
  const plan: PackPlan = planPack({ dispute: c.dispute, facts, docs, verifiedRefunds: c.refunds, now: EVAL_NOW });
  const g = c.gold;
  const quarantined = docs.filter((d) => d.quarantined).map((d) => d.name);
  const checks = {
    verdict: plan.verdict === g.verdict,
    type: g.verdict !== "READY" || plan.evidenceType === g.evidenceType,
    attach: (g.attach ?? []).every((n: string) => plan.documentIds.includes(n)),
    notAttach: (g.notAttach ?? []).every((n: string) => !plan.documentIds.includes(n)),
    quarantine: (g.quarantine ?? []).every((n: string) => quarantined.includes(n)) && quarantined.every((n) => (g.quarantine ?? []).includes(n)),
    carrier: !g.carrier || plan.evidenceInfo.tracking_info?.[0]?.carrier_name === g.carrier,
  };
  // Dangerous: ClaimPack would let a person file something it should not (a pack that is not ready, or a document
  // that must never go to PayPal).
  const dangerous = (plan.verdict === "READY" && g.verdict !== "READY") || !checks.notAttach;
  let draft: any = null;
  if (DRAFT && plan.verdict === "READY") {
    const file = join(RUN_DIR, `${c.id}.draft.json`);
    if (existsSync(file)) draft = JSON.parse(readFileSync(file, "utf8"));
    else if (ai) {
      const d = await draftStatement(ai.client, ai.model, c.dispute, plan, facts, docs);
      draft = { statement: d.statement, ok: d.check.ok, attempts: d.attempts, problems: d.check.problems, notes: d.check.notes, costUsd: d.costUsd };
      writeFileSync(file, JSON.stringify(draft, null, 1));
    }
    draftCost += draft?.costUsd ?? 0;
  }
  rows.push({ id: c.id, title: c.title, trap: c.trap, gold: g.verdict, got: plan.verdict, goldType: g.evidenceType ?? null, gotType: plan.evidenceType ?? null,
    completeness: plan.completeness, attached: plan.documentIds, quarantined, checks, ok: Object.values(checks).every(Boolean), dangerous,
    facts: facts.length, dropped: mine.reduce((s, x) => s + (x.r?.dropped.length ?? 0), 0), draft: draft && { ok: draft.ok, attempts: draft.attempts } });
}

const pct = (a: number, b: number) => `${a}/${b}`;
const n = rows.length;
const summary = {
  run: RUN, cases: n, documents: jobs.length, readerModel: process.env.META_MODEL_EXTRACT || "muse-spark-1.3", scoredAt: new Date().toISOString(), evalNow: EVAL_NOW,
  allChecks: pct(rows.filter((r) => r.ok).length, n),
  verdicts: pct(rows.filter((r) => r.checks.verdict).length, n),
  evidenceType: pct(rows.filter((r) => r.gold === "READY" && r.checks.type).length, rows.filter((r) => r.gold === "READY").length),
  attachments: pct(rows.filter((r) => r.checks.attach && r.checks.notAttach).length, n),
  injectionsCaught: pct(rows.filter((r) => cases.find((c: any) => c.id === r.id).gold.quarantine && r.checks.quarantine).length, cases.filter((c: any) => c.gold.quarantine).length),
  falseQuarantines: rows.filter((r) => !cases.find((c: any) => c.id === r.id).gold.quarantine && r.quarantined.length).length,
  dangerous: rows.filter((r) => r.dangerous).length,
  statements: DRAFT ? { drafted: rows.filter((r) => r.draft).length, passedGuard: rows.filter((r) => r.draft?.ok).length, firstAttempt: rows.filter((r) => r.draft?.ok && r.draft.attempts === 1).length } : null,
  costUsd: { reading: Number(readCost.toFixed(4)), drafting: Number(draftCost.toFixed(4)) },
  failures: rows.filter((r) => !r.ok).map((r) => ({ id: r.id, title: r.title, gold: r.gold, got: r.got, failed: Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k) })),
};
writeFileSync(join(RUN_DIR, "results.json"), JSON.stringify({ summary, rows }, null, 1));
mkdirSync(join(ROOT, "eval", "results"), { recursive: true });
writeFileSync(join(ROOT, "eval", "results", `${RUN}.json`), JSON.stringify(summary, null, 1));

console.log("\n id  | gold        | got         | type | attach | ok | trap");
for (const r of rows) console.log(` ${r.id} | ${r.gold.padEnd(11)} | ${r.got.padEnd(11)} | ${r.checks.type ? " ok " : "FAIL"} | ${r.checks.attach && r.checks.notAttach ? "  ok  " : " FAIL "} | ${r.ok ? "ok" : "--"}${r.dangerous ? " DANGEROUS" : ""} | ${r.trap}`);
console.log("\n" + JSON.stringify({ ...summary, failures: undefined }, null, 1));
if (summary.failures.length) console.log("failures:", JSON.stringify(summary.failures, null, 1));
