// The statement guard. The model drafts the seller's statement to PayPal; this code decides whether it may be sent.
// Every sentence must cite at least one fact the rules engine used, and every number, date, link or email in it must
// appear in what those facts (or PayPal's own record of the dispute) actually say. Nothing is added or "improved".
import type { DisputeCase, EvidenceDoc, Fact } from "../types";

export const MAX_NOTES = 2000;
const ACCUSATION = /\b(fraud|fraudulent|scam(mer)?|lying|liar|lied|steal(ing)?|stole|thief|criminal|dishonest)\b/i;
const CITE = /\[(F[\w-]+)\]/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const M = `(${MONTHS.join("|")})[a-z]*\\.?`;
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${M},?\\s+(\\d{4})\\b`, "gi");
const MONTH_FIRST = new RegExp(`\\b${M}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi");

export interface StatementCheck {
  ok: boolean;
  problems: { sentence: string; problem: string }[];
  /** the text PayPal receives: citation markers replaced by the document names */
  notes: string;
}

const flat = (s: string) => s.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");

/** Every number in the text, whole ("2026-11-05", "120.00", "16:07:00") and split into parts ("2026", "11", "05"). */
function numberTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.match(/\d[\d.:/-]*\d|\d/g) ?? []) {
    out.add(tok);
    for (const part of tok.split(/[.:/-]/)) if (part) out.add(part);
  }
  return out;
}

const ABBR = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|no|approx|inc|ltd|st)\.$/i;

/**
 * Splits into sentences. A . ! or ? ends a sentence only when a space (or the end) follows it, so "14.2" and
 * "shop.example.com" stay whole; never inside "quotes" or (brackets); never after an abbreviation such as "e.g.".
 * Citations right after the full stop ("… date. [F1]") stay with their sentence.
 */
export function sentences(text: string): string[] {
  const s = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let start = 0, quote = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (c === "“") quote = true;
    else if (c === "”") quote = false;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (quote || depth > 0 || !/[.!?]/.test(c)) continue;
    let j = i + 1 + (s.slice(i + 1).match(/^(?:\s*\[F[\w-]+\])*\.?/)?.[0].length ?? 0);
    if (j < s.length && s[j] !== " ") continue;
    if (c === "." && ABBR.test(s.slice(start, i + 1))) continue;
    out.push(s.slice(start, j).trim());
    start = j;
    i = j - 1;
  }
  if (s.slice(start).trim()) out.push(s.slice(start).trim());
  return out;
}

export function checkStatement(draft: string, facts: Fact[], usedFactIds: string[], dispute: DisputeCase, docs: EvidenceDoc[]): StatementCheck {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const docName = new Map(docs.map((d) => [d.id, d.name]));
  const known = flat([dispute.id, dispute.amount.value, dispute.transaction.id, dispute.transaction.invoiceId ?? "", dispute.transaction.amount.value,
    dispute.createTime, dispute.transaction.createTime].join(" "));
  const problems: StatementCheck["problems"] = [];

  const parts = sentences(draft);
  if (!parts.length) problems.push({ sentence: "", problem: "The statement is empty." });

  for (const s of parts) {
    const ids = [...s.matchAll(CITE)].map((m) => m[1]);
    let text = s.replace(CITE, "").replace(/\s+([.!?])/g, "$1").trim();
    if (!ids.length) { problems.push({ sentence: text, problem: "cites no document" }); continue; }
    const bad = ids.filter((id) => !usedFactIds.includes(id) || !byId.has(id));
    if (bad.length) problems.push({ sentence: text, problem: `cites ${bad.join(", ")}, which is not part of this evidence pack` });
    const cited = ids.map((id) => byId.get(id)).filter(Boolean) as Fact[];
    const hay = known + " " + flat(cited.map((f) => JSON.stringify(f)).join(" "));
    const nums = numberTokens(hay);
    const report = text;

    // Written-out dates ("5 November 2026", "November 5, 2026") must name a date the cited facts contain.
    const dateHit = (day: string, mon: string, year: string, whole: string) => {
      const mm = String(MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1).padStart(2, "0");
      const iso = `${year}-${mm}-${day.padStart(2, "0")}`;
      const quoted = cited.some((f) => new RegExp(`\\b0?${Number(day)}\\s+${mon.slice(0, 3)}[a-z]*\\.?,?\\s+${year}\\b`, "i").test(f.cite.quote));
      if (!hay.includes(iso) && !quoted) problems.push({ sentence: report, problem: `the date "${whole}" does not appear in the cited documents` });
      return " ";
    };
    text = text.replace(DAY_FIRST, (w, d, m, y) => dateHit(d, m, y, w)).replace(MONTH_FIRST, (w, m, d, y) => dateHit(d, m, y, w));

    for (const tok of text.match(/\d[\d,.:/-]*\d|\d/g) ?? []) {
      const n = flat(tok).replace(/[.:/-]$/, "");
      // "18:02" may stand for a record's "18:02:00".
      const timePrefix = /^\d{1,2}:\d{2}$/.test(n) && [...nums].some((x) => x.startsWith(n + ":") || x.startsWith(n.padStart(5, "0") + ":"));
      if (!nums.has(n) && !timePrefix) problems.push({ sentence: report, problem: `"${tok}" does not appear in the cited documents` });
    }
    for (const tok of text.match(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])
      if (!hay.includes(flat(tok).replace(/[.,)]$/, ""))) problems.push({ sentence: report, problem: `"${tok}" does not appear in the cited documents` });
    if (ACCUSATION.test(text)) problems.push({ sentence: report, problem: "accuses the buyer; state facts only" });
  }

  const notes = parts
    .map((s) => s.replace(/(\s*\[F[\w-]+\])+/g, (m) => {
      const names = [...new Set([...m.matchAll(CITE)].map((x) => byId.get(x[1])).filter(Boolean).map((f) => docName.get(f!.cite.docId) ?? f!.cite.docId))];
      return names.length ? ` (see ${names.join(", ")})` : "";
    }).replace(/\.\s*\(see ([^)]*)\)\s*\.$/, " (see $1).").replace(/\s+([.!?])$/, "$1"))
    .join(" ");
  if (notes.length > MAX_NOTES) problems.push({ sentence: "", problem: `The statement is ${notes.length} characters; keep it under ${MAX_NOTES}.` });
  return { ok: problems.length === 0, problems, notes };
}
