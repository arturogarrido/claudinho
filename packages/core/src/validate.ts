/**
 * Small input validators shared across clients. Pure, dependency-free, and
 * safe in Node and Workers.
 */

/** True if `tz` is an IANA timezone the runtime accepts (e.g. "America/Mexico_City"). */
export function isValidTimeZone(tz: string | undefined | null): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError on an unknown/ill-formed zone.
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * True if `s` is a real calendar date in strict `YYYY-MM-DD` form. Rejects
 * malformed strings AND impossible dates that JS would otherwise roll over
 * (e.g. "2026-02-30").
 */
export function isValidDate(s: string | undefined | null): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Round-trip guard: rollover dates won't match their input.
  return d.toISOString().slice(0, 10) === s;
}
