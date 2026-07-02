/**
 * Feed-string sanitizer — the chokepoint between untrusted provider data and
 * every output surface (terminal, statusline, share cards, and the Claude Code
 * hook, whose stdout lands in the model's context). Strips control characters
 * (C0 incl. ESC, DEL, C1) so a compromised feed can't inject ANSI escapes or
 * multi-line text, and caps length so one field can't flood a surface.
 *
 * Applied at the ESPN adapter boundary (toTeam / mapEspnEvent) and mirrored on
 * the statusline's cache reads (defense against a poisoned cache file).
 */
import type { Match, Team } from './types';

/** Default per-field cap — generous for any real team/venue name. */
export const FEED_TEXT_MAX = 100;

/**
 * Strip C0/C1 control characters (including ESC) and cap at `max` code points.
 * Whitespace controls (tab/newline/CR) become a single space so words a hostile
 * feed split across lines don't fuse together. Total: never throws.
 */
export function sanitizeFeedText(value: string, max = FEED_TEXT_MAX): string {
  let out = '';
  let count = 0;
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0) ?? 0;
    const isWhitespaceControl = cp === 0x09 || cp === 0x0a || cp === 0x0d;
    if ((cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) && !isWhitespaceControl) continue;
    if (count >= max) break;
    out += isWhitespaceControl ? ' ' : ch;
    count++;
  }
  return out;
}

/** Sanitized copy of a team's display strings. Tolerates malformed input. */
function sanitizeTeam(t: Team | undefined): Team {
  return {
    ...(t ?? {}),
    code: sanitizeFeedText(t?.code ?? ''),
    name: sanitizeFeedText(t?.name ?? ''),
    flag: sanitizeFeedText(t?.flag ?? ''),
  };
}

/**
 * Sanitized copy of every display string on a Match. Used on cache reads (the
 * statusline/hook render straight from the cache file), so it must be total:
 * a malformed entry yields empty strings, never a throw.
 */
export function sanitizeMatchStrings(m: Match): Match {
  return {
    ...m,
    venue: sanitizeFeedText(m.venue ?? ''),
    city: m.city == null ? m.city : sanitizeFeedText(m.city),
    country: m.country == null ? m.country : sanitizeFeedText(m.country),
    home: sanitizeTeam(m.home),
    away: sanitizeTeam(m.away),
  };
}
