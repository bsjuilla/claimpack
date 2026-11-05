// The statement guard. The model drafts the seller's statement to PayPal; this code decides whether it may be sent.
// Every sentence must cite at least one fact the rules engine used, and every number, date, link or email in it must
// appear in what those facts (or PayPal's own record of the dispute) actually say. Nothing is added or "improved".
import type { DisputeCase, EvidenceDoc, Fact } from "../types";

export const MAX_NOTES = 2000;
const ACCUSATION = /\b(fraud|fraudulent|scam(mer)?|lying|liar|lied|steal(ing)?|stole|thief|criminal|dishonest)\b/i;
const CITE = /\[(F[\w-]+)\]/g;

export interface StatementCheck {
  ok: boolean;
  problems: { sentence: string; problem: string }[];
  /** the text PayPal receives: citation markers replaced by the document names */
  notes: string;
}

const flat = (s: string) => s.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";

/** Every number in the text, whole ("2026-11-05", "120.00", "16:07") and split into its parts ("2026", "11", "05"). */
function numberTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.match(/\d[\d.:/-]*\d|\d/g) ?? []) {
    out.add(tok);
    for (const part of tok.split(/[.:/-]|t/)) if (part) out.add(part);
  }
  return out;
}

export function checkStatement(draft: string, facts: Fact[], usedFactIds: string[], dispute: DisputeCase, docs: EvidenceDoc[]): StatementCheck {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const docName = new Map(docs.map((d) => [d.id, d.name]));
  const known = flat([dispute.id, dispute.amount.value, dispute.transaction.id, dispute.transaction.invoiceId ?? "", dispute.transaction.amount.value,
    dispute.createTime, dispute.transaction.createTime].join(" "));
  const problems: StatementCheck["problems"] = [];

  const sentences = draft.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z"“(])/).filter((s) => s.trim());
  if (!sentences.length) problems.push({ sentence: "", problem: "The statement is empty." });

  for (const s of sentences) {
    const ids = [...s.matchAll(CITE)].map((m) => m[1]);
    const text = s.replace(CITE, "").trim();
    if (!ids.length) { problems.push({ sentence: text, problem: "cites no document" }); continue; }
    const bad = ids.filter((id) => !usedFactIds.includes(id) || !byId.has(id));
    if (bad.length) problems.push({ sentence: text, problem: `cites ${bad.join(", ")}, which is not part of this evidence pack` });
    const hay = known + " " + flat(ids.map((id) => byId.get(id)).filter(Boolean).map((f) => JSON.stringify(f)).join(" "));
    const nums = numberTokens(hay);
    for (const tok of text.match(/\d[\d,.:/-]*\d|\d/g) ?? []) {
      const n = flat(tok).replace(/[.:/-]$/, "");
      // "5 November" may stand for a document's "05 Nov"; a bare "5" may not borrow the 05 of a date.
      const dayOfMonth = /^\d{1,2}$/.test(n) && new RegExp(`\\b${n}(st|nd|rd|th)?\\s+${MONTH}|${MONTH}\\w*\\.?\\s+${n}\\b`, "i").test(text) && nums.has(n.padStart(2, "0"));
      if (!nums.has(n) && !dayOfMonth) problems.push({ sentence: text, problem: `"${tok}" does not appear in the cited documents` });
    }
    for (const tok of text.match(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])
      if (!hay.includes(flat(tok).replace(/[.,)]$/, ""))) problems.push({ sentence: text, problem: `"${tok}" does not appear in the cited documents` });
    if (ACCUSATION.test(text)) problems.push({ sentence: text, problem: "accuses the buyer; state facts only" });
  }

  const notes = sentences
    .map((s) => s.replace(/(\s*\[F[\w-]+\])+/g, (m) => {
      const names = [...new Set([...m.matchAll(CITE)].map((x) => byId.get(x[1])).filter(Boolean).map((f) => docName.get(f!.cite.docId) ?? f!.cite.docId))];
      return names.length ? ` (see ${names.join(", ")})` : "";
    }).replace(/\s+([.!?])$/, "$1").replace(/\)\s*([.!?])$/, ")$1"))
    .join(" ");
  if (notes.length > MAX_NOTES) problems.push({ sentence: "", problem: `The statement is ${notes.length} characters; keep it under ${MAX_NOTES}.` });
  return { ok: problems.length === 0, problems, notes };
}
