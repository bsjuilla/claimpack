// Dates sellers' records write loosely ("05/10 08:45", "5.10.26"). The reader copies them as written and never guesses
// a year; this code picks the reading nearest the payment, and the engine tells the seller what it assumed.

const RE = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:[ T,]+(\d{1,2}):(\d{2}))?/;

/** Every distinct calendar reading of a loose date (day-first and month-first) in the payment's year. */
export function looseDateReadings(text: string, refIso: string): string[] {
  const m = text.match(RE);
  if (!m) return [];
  const y = new Date(Date.parse(refIso)).getUTCFullYear();
  const out = new Set<string>();
  for (const [day, month] of [[Number(m[1]), Number(m[2])], [Number(m[2]), Number(m[1])]]) {
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const t = Date.UTC(m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : y, month - 1, day);
    if (new Date(t).getUTCDate() === day) out.add(new Date(t).toISOString().slice(0, 10));
  }
  return [...out];
}

/** Returns "YYYY-MM-DDTHH:MM" (no timezone, as written) for the reading of `text` nearest `refIso`, or undefined. */
export function resolveLooseDate(text: string, refIso: string): string | undefined {
  const m = text.match(RE);
  if (!m) return undefined;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const ref = Date.parse(refIso);
  if (Number.isNaN(ref)) return undefined;
  const refYear = new Date(ref).getUTCFullYear();
  const years = m[3] ? [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])] : [refYear - 1, refYear, refYear + 1];
  const hh = m[4] ? Number(m[4]) : 12, mm = m[5] ? Number(m[5]) : 0;
  const options: { t: number; iso: string }[] = [];
  for (const [day, month] of [[a, b], [b, a]]) {
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    for (const y of years) {
      const t = Date.UTC(y, month - 1, day, hh, mm);
      if (new Date(t).getUTCDate() !== day) continue; // 31/02 and the like
      const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` + (m[4] ? `T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : "");
      options.push({ t, iso });
    }
  }
  if (!options.length) return undefined;
  return options.sort((x, y) => Math.abs(x.t - ref) - Math.abs(y.t - ref))[0].iso;
}
