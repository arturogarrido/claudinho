/**
 * `claudinho hook` — a UserPromptSubmit / SessionStart hook for Claude Code.
 *
 * Claude Code injects this command's stdout into the model's context. So when a
 * match is in progress, the agent silently becomes score-aware and can mention
 * it naturally. When nothing is live, we print NOTHING — an empty hook adds no
 * tokens and no noise to the conversation.
 *
 * Hard rule: this runs on every prompt submit, so it must be fast (cache read
 * only, no network) and must NEVER fail in a way that blocks the prompt. The
 * caller always exits 0.
 */
import { lookupTeam, scoreline, type Match, type Team } from '@claudinho/core';
import type { readState } from './cache';
import { liveMatchCountFromCache, liveMatchesFromCache } from './statusline';

/**
 * Live matches listed in the hook's context. Well above any real simultaneity
 * (a World Cup matchday peaks at 12, with at most 6 kicking off together).
 */
const MAX_HOOK_MATCHES = 12;

export interface HookOpts {
  /** Preferred team code (e.g. "MEX") — listed first. */
  team?: string;
  /** Render emoji flags (default true); false → names only, for flagless terminals. */
  flags?: boolean;
  now?: Date;
}

/**
 * The team as rendered INTO CLAUDE'S CONTEXT. When the code resolves against
 * the bundled roster (every real tournament team), the name and flag are
 * pinned to the STATIC roster — feed/cache text can then never smuggle prose
 * (e.g. "ignore previous instructions" as a "team name") into the model's
 * context. Unknown codes (other competitions) fall back to the sanitized feed
 * name — control characters and newlines are already stripped upstream.
 */
function rosterPinned(t: Team): Team {
  const { team } = lookupTeam(t.code);
  return team ? { ...t, name: team.name, flag: team.flag } : t;
}

function line(m: Match, flags: boolean): string {
  const minute = m.status === 'HT' ? 'half-time' : m.minute ? `${m.minute}'` : 'live';
  const h = rosterPinned(m.home);
  const a = rosterPinned(m.away);
  const home = flags ? `${h.flag} ${h.name}` : h.name;
  const away = flags ? `${a.name} ${a.flag}` : a.name;
  return `${home} ${scoreline(m)} ${away} (${minute})`;
}

/**
 * Build the context string. Returns '' when nothing is live (the common case),
 * so the hook contributes zero tokens outside of match windows. Pure + total:
 * given a cache snapshot, never throws.
 */
export function renderHook(
  state: ReturnType<typeof readState>,
  opts: HookOpts = {},
): string {
  const now = opts.now ?? new Date();
  const team = opts.team?.toUpperCase();
  const flags = opts.flags ?? true;

  let live = liveMatchesFromCache(state, now.getTime());
  if (live.length === 0) return '';
  // The TRUE total. `liveMatchesFromCache` is bounded to protect the hot path,
  // so counting the overflow from its result understated it — the statusline had
  // the same bug and the same fix; a count that is quietly wrong reads as a
  // complete list.
  const total = Math.max(liveMatchCountFromCache(state, now.getTime()), live.length);

  // Surface the user's team first, if any.
  if (team) {
    live = [...live].sort((a, b) => {
      const aHas = a.home.code === team || a.away.code === team ? 0 : 1;
      const bHas = b.home.code === team || b.away.code === team ? 0 : 1;
      return aHas - bHas;
    });
  }

  // Bound the RECORD COUNT. This text is injected into Claude's context on
  // every prompt submit, and while each field is capped, nothing capped how
  // many matches a poisoned cache could list — a 500-record file produced
  // 2,002 lines of context. `renderPrompt` has had this cap (CLAUDINHO_MAX);
  // the hook, the surface that actually writes into the model, had none.
  const shown = live.slice(0, MAX_HOOK_MATCHES);
  const overflow = total - shown.length;
  const lines = shown.map((mm) => line(mm, flags)).join('\n');
  // Truncation is stated, never silent (English-only, like the rest of the
  // hook — see the ambient-surface carve-out in AGENTS.md).
  const more = overflow > 0 ? `\n(+${overflow} more not shown)` : '';
  // Labelled as live context so the model treats it as ambient info, not an
  // instruction. Kept terse to minimise token cost.
  return `[Claudinho — live football scores right now]\n${lines}${more}`;
}
