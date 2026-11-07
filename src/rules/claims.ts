// Further statement checks, added after the adversarial review of 7 November 2026 (13 of 13 crafted false statements
// passed the first guard). These are still word-level checks: they catch the patterns a drafted statement uses to say
// more than its evidence (spelled-out numbers, units, currencies, relative dates, invented quotes, names, negations,
// claim verbs), and they lean strict. They do not prove a sentence true; the person approving reads each sentence
// next to the words it cites.

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12, twice: 2, thrice: 3,
};
const UNITS = "kg|kgs|kilograms?|grams?|g|lbs?|pounds?|ounces?|oz|mb|gb|kb|tb|bytes?|files?|copies|copy|downloads?|times|pages?|items?|units?|days?|hours?|minutes?|weeks?|months?|km|miles?|cm|mm|inches?|percent|%";
const CURRENCY: [RegExp, string][] = [
  [/\$|\bdollars?\b|\busd\b/i, "usd"], [/€|\beuros?\b|\beur\b/i, "eur"], [/£|\bgbp\b|\bsterling\b/i, "gbp"],
  [/¥|\byen\b|\bjpy\b/i, "jpy"], [/\brupees?\b|\bmur\b|\binr\b/i, "rupee"], [/\bcad\b|\baud\b|\bchf\b/i, "other"],
];
const RELATIVE = /\b(yesterday|today|tonight|tomorrow|(the\s+)?(next|following|previous|same)\s+(day|morning|evening|week|month)|(a|one|two|few|several|\d+)\s+(minutes?|hours?|days?|weeks?)\s+(later|after|before|earlier|ago)|later\s+that\s+day|shortly\s+(after|before)(wards)?|right\s+away|immediately|soon\s+after)\b/i;
const NEGATION = /\b(never|not|no|none|nothing|nobody|neither|nor|without|didn't|did\s+not|doesn't|does\s+not|wasn't|was\s+not|hasn't|has\s+not|haven't|cannot|can't|won't|wouldn't|refused|failed)\b/i;
// Claim verbs: if the statement says the buyer (or anyone) did one of these, the cited words must say it too.
const CLAIM_STEMS = ["satisf", "happy", "pleased", "delight", "love", "confirm", "approv", "accept", "agree", "sign", "waiv", "withdr", "cancel", "refund", "return", "receiv", "acknowledg", "admit", "thank", "complain", "dispute"];
const NAME_OK = new Set(["paypal", "utc", "gmt", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "the", "on", "at", "in", "a", "an", "this", "that", "proof", "item", "order", "invoice"]);

export interface ClaimInput {
  text: string; // the sentence without citation markers
  quotes: string[]; // exact quotes and the reader's wording of the cited facts
  hay: string; // flattened text of the cited facts and PayPal's record (lower case)
  nums: Set<string>; // every number token in hay
  isoDates: string[]; // ISO dates the cited facts contain (YYYY-MM-DD)
}

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[“”"]/g, '"').replace(/[‘’]/g, "'").replace(/[^a-z0-9%$€£'".:/-]+/g, " ").trim();

export function claimProblems({ text, quotes, hay, nums, isoDates }: ClaimInput): string[] {
  const out: string[] = [];
  const t = text;
  const lower = t.toLowerCase();
  const said = quotes.map(norm).join(" | ");

  // Spelled-out numbers and multipliers ("five times", "one hundred and fifty", "twice").
  for (const m of lower.matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|twice|thrice)\b/g)) {
    const w = m[1];
    // "one" as a pronoun or article ("one file", "the one that") is left to the unit check; count it only before a unit or another number word.
    if (w === "one" && !new RegExp(`\\bone\\s+(${UNITS}|hundred|thousand|dozen)\\b`).test(lower)) continue;
    if (!nums.has(String(NUMBER_WORDS[w])) && !said.includes(w)) out.push(`"${w}" is a number the cited documents do not contain`);
  }

  // A number with a unit, percentage or count must appear with that unit in the cited words ("120 bytes" is not "120 kilograms").
  for (const m of t.matchAll(new RegExp(`(\\d[\\d,.]*)\\s*(${UNITS})(?![a-z])`, "gi"))) {
    const n = m[1].replace(/,/g, "").replace(/\.$/, ""), unit = m[2].toLowerCase();
    const stem = unit === "%" || unit === "percent" ? "(%|\\s?percent)" : `\\s?${unit.replace(/s$|es$/, "").slice(0, 4)}`;
    if (!new RegExp(`(^|[^\\d.])${n.replace(/\./g, "\\.")}${stem}`, "i").test(hay)) out.push(`"${m[0].trim()}" does not appear with that unit in the cited documents`);
  }

  // Currency: any currency named must be the one in the documents or PayPal's record.
  for (const [re, code] of CURRENCY) if (re.test(t) && !re.test(hay) && !hay.includes(code)) out.push(`names a currency (${t.match(re)![0]}) that the cited documents do not use`);

  // Relative time ("the next day", "yesterday") cannot be checked against a date.
  const rel = lower.match(RELATIVE);
  if (rel && !said.includes(norm(rel[0]))) out.push(`"${rel[0]}" is a relative time; give the date and time from the documents instead`);

  // Day and month without a year must match a date the documents contain.
  for (const m of lower.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?!,?\s*\d{4})\b/g)) {
    const mm = String(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2]) + 1).padStart(2, "0");
    if (!isoDates.some((d) => d.slice(5) === `${mm}-${m[1].padStart(2, "0")}`)) out.push(`the date "${m[0]}" does not appear in the cited documents`);
  }

  // Anything in quotation marks must be copied from the cited documents.
  for (const m of t.matchAll(/["“]([^"”]{3,})["”]/g)) {
    const q = norm(m[1]).replace(/[.!?,;:]+$/, "");
    if (!said.includes(q)) out.push(`the quotation "${m[1].slice(0, 60)}" is not in the cited documents`);
  }

  // Names (two or more capitalised words) must appear in the documents.
  for (const m of t.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    const words = m[1].split(/\s+/).filter((w) => !NAME_OK.has(w.toLowerCase()));
    if (words.length >= 2 && !hay.includes(words.join(" ").toLowerCase())) out.push(`"${m[1]}" is a name the cited documents do not contain`);
  }

  // A negative statement needs a negative in the cited words ("never reported a problem" cannot rest on a download log).
  const neg = lower.match(NEGATION);
  if (neg && !NEGATION.test(said)) out.push(`"${neg[0]}" states a negative the cited documents do not`);

  // Claim verbs must be in the cited words.
  for (const stem of CLAIM_STEMS) {
    if (new RegExp(`\\b${stem}`, "i").test(lower) && !new RegExp(`\\b${stem}`, "i").test(said)) out.push(`says "${lower.match(new RegExp(`\\b${stem}\\w*`))![0]}", which the cited documents do not say`);
  }
  return out;
}

/** Whole-statement checks: brackets and quotes must balance, so no sentence can hide inside an unclosed one. */
export function structureProblems(draft: string): string[] {
  const out: string[] = [];
  const d = draft.normalize("NFKC");
  if ((d.match(/"/g) ?? []).length % 2 !== 0 || (d.match(/“/g) ?? []).length !== (d.match(/”/g) ?? []).length) out.push("A quotation mark is not closed.");
  if ((d.match(/\(/g) ?? []).length !== (d.match(/\)/g) ?? []).length) out.push("A bracket is not closed.");
  // Look-alike digits and letters from other scripts can slip past the checks above; plain text only.
  const odd = [...new Set(draft.replace(/[“”‘’–—…€£¥é]/g, "").match(/[^\x00-\x7F]/g) ?? [])].join(" ");
  if (odd) out.push(`Unusual characters (${odd.slice(0, 20)}): write the statement in plain characters.`);
  return out;
}
