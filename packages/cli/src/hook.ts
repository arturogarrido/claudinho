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
import { MAX_LIVE_CONSIDERED, liveCacheRecordCount, liveMatchesFromCache } from './statusline';

/**
 * Live matches listed in the hook's context. Well above any real simultaneity
 * (a World Cup matchday peaks at 12, with at most 6 kicking off together).
 */
const MAX_HOOK_MATCHES = 12;

/**
 * Hard ceiling on the WHOLE injected block, in code points.
 *
 * Every field is bounded and so is the record count, but neither bounds their
 * SUM — twelve records whose every label sits just under its own cap produced
 * 19.5 KB of model context. This is the surface that writes into Claude on
 * every prompt submit, so the aggregate needs its own limit, exactly as
 * `renderPrompt` caps the whole line rather than each segment. A real matchday
 * block is well under 1 KB.
 *
 * Applied as a wrapper over the return rather than inside each branch, so a
 * branch added later cannot forget it.
 */
const MAX_HOOK_CODE_POINTS = 4096;

function boundContext(text: string, marker = ''): string {
  const points = [...text];
  if (points.length + [...marker].length <= MAX_HOOK_CODE_POINTS) return text + marker;
  // The overflow marker is the honest part of this block — it is what says the
  // list is incomplete — so it is RESERVED and re-appended rather than cut off
  // the end. The statusline reserves its marker's width for the same reason;
  // the hook truncated straight through it, turning an incomplete list back
  // into one that reads as complete.
  const room = Math.max(0, MAX_HOOK_CODE_POINTS - [...marker].length);
  return `${points.slice(0, room).join('')}\n(context truncated)${marker}`;
}

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
  // "+N" is a claim about MATCHES, and a record we read and could not use is not
  // one. Two honest sources, and only two: matches we sealed but did not show,
  // and records past the examine cap we never looked at. A record we DID examine
  // and rejected belongs to neither.
  //
  // The statusline had exactly this bug and exactly this fix; the hook kept the
  // shape-only count, so 60 unreadable records read as "(+60 more not shown)"
  // — in Claude's context, which is worse than on a prompt line. Fixing one
  // surface and not its sibling is the recurring mistake in this codebase.
  const unexamined = Math.max(0, liveCacheRecordCount(state, now.getTime()) - MAX_LIVE_CONSIDERED);
  const total = live.length + unexamined;

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
  return boundContext(`[Claudinho — live football scores right now]\n${lines}`, more);
}
