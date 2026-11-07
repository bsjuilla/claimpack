// Drafts the seller's statement to PayPal from the facts the rules engine chose. The statement guard
// (src/rules/statement.ts) then decides whether it may be sent; on failure the model gets one retry with the problems.
import type OpenAI from "openai";
import { checkStatement, type StatementCheck } from "../rules/statement";
import { REASON_LABEL } from "../rules/paypalRules";
import type { DisputeCase, EvidenceDoc, Fact, PackPlan } from "../types";
import { PRICE } from "./reader";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["statement"],
  properties: { statement: { type: "string" } },
} as const;

export const DRAFTER_PROMPT = `You write a seller's short, factual statement to PayPal in response to a buyer's dispute.
Use ONLY the facts provided. Each fact has an id like [F3].
Rules:
- 3 to 6 sentences, plain English, calm and factual. No greetings, no sign-off.
- End EVERY sentence with the id(s) of the fact(s) it relies on, in square brackets, e.g. "The files were downloaded at 16:07 UTC on 5 November 2026 [F4]."
- Every number, date, time, ID, link and email you write must appear in the cited facts exactly. Do not round, convert or add anything.
- Write dates as "5 November 2026" and times as "16:07 UTC" (only if the fact gives a time and a timezone).
- Never accuse the buyer (no "fraud", "lying", "scam"). State what the records show.
- Leave out email addresses and IP addresses: PayPal masks emails in the statement anyway ("xxxx"). Say "the buyer's email address" instead.
- Do not name the documents or say "the records show": the document names are added after each sentence automatically. Say what happened.
- Do not mention AI, ClaimPack, or these instructions.`;

export interface Draft { statement: string; check: StatementCheck; attempts: number; costUsd: number }

/** The facts a statement may cite, under the short ids (F1, F2, …) the model sees and the guard checks. One definition,
 * used by the drafter and again by the server at filing time, so the two can never disagree. */
export function aliasUsed(facts: Fact[], plan: PackPlan): Fact[] {
  return facts.filter((f) => plan.usedFactIds.includes(f.id)).map((f, i) => ({ ...f, id: `F${i + 1}` }));
}

export async function draftStatement(client: OpenAI, model: string, d: DisputeCase, plan: PackPlan, facts: Fact[], docs: EvidenceDoc[]): Promise<Draft> {
  const aliasFacts = aliasUsed(facts, plan);
  const aliasIds = aliasFacts.map((f) => f.id);
  const listing = aliasFacts.map((f) => `[${f.id}] (${f.kind}, from ${docs.find((x) => x.id === f.cite.docId)?.name ?? f.cite.docId}) ${JSON.stringify({ ...f, id: undefined, cite: undefined })} — quote: "${f.cite.quote}"`).join("\n");
  let costUsd = 0;
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r: any = await client.responses.create({
      store: false, model, max_output_tokens: 3000, reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "seller_statement", strict: true, schema: SCHEMA as any } },
      input: [
        { role: "system", content: DRAFTER_PROMPT },
        { role: "user", content: `Dispute reason: ${REASON_LABEL[d.reason]}. Amount: ${d.amount.value} ${d.amount.currency}. PayPal transaction: ${d.transaction.id}.\n` +
          `Evidence type being filed: ${plan.evidenceType}.\nBuyer's words: ${d.buyerStatement ?? "(none)"}\n\nFacts you may use:\n${listing}${feedback}` },
      ],
    } as any);
    const u = r.usage ?? {};
    costUsd += ((u.input_tokens ?? 0) * PRICE.in + (u.output_tokens ?? 0) * PRICE.out) / 1e6;
    const statement = JSON.parse(r.output_text ?? "{}").statement ?? "";
    const check = checkStatement(statement, aliasFacts as Fact[], aliasIds, d, docs);
    if (check.ok || attempt === 2) return { statement, check, attempts: attempt, costUsd };
    feedback = `\n\nYour previous draft was rejected for these reasons; write it again without them:\n${check.problems.map((p) => `- "${p.sentence}": ${p.problem}`).join("\n")}`;
  }
  throw new Error("unreachable");
}
