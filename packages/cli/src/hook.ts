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
import { lookupTeam, scoreline, withFlag, type Match, type Team, type TeamKind } from '@claudinho/core';
import type { readState } from './cache';
import { type AmbientPick, defaultTeamKind, liveMatchesFromCache, pickAmbientMatch } from './statusline';

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
  /**
   * Whose match is listed first (`pickAmbientMatch`, the statusline's one
   * rule): `CLAUDINHO_TEAM` by code, else the saved pin. The others follow.
   */
  pick?: AmbientPick;
  /** Render emoji flags (default true); false → names only, for flagless terminals. */
  flags?: boolean;
  now?: Date;
  /**
   * Whether the bundled (World Cup) roster describes the teams in the cache.
   * False when `CLAUDINHO_COMPETITION` points elsewhere: a club's ESPN
   * abbreviation can equal a nation's code (`ESP` is Espanyol in LaLiga, `PAR`
   * is Parma in Serie A, `POR` is Portland in MLS), so pinning by code would
   * rename a club to a nation INSIDE Claude's context. Resolved by the caller,
   * like `renderPrompt`'s `defaultCompetition` (this module stays env-free).
   */
  defaultCompetition?: boolean;
  /**
   * The cached teams' kind, the competition's written fact, resolved by the
   * caller like `defaultCompetition`: a `nation` side carries its generated
   * flag, a `club` side none, and nothing is printed in its place. Absent:
   * `nation` on the bundled competition, `club` off it.
   */
  teamKind?: TeamKind;
}

/**
 * The team as rendered INTO CLAUDE'S CONTEXT. On the bundled competition a
 * code that resolves against the bundled roster (every real tournament team)
 * has its name and flag pinned to the STATIC roster — feed/cache text can then
 * never smuggle prose (e.g. "ignore previous instructions" as a "team name")
 * into the model's context. Unknown codes, and every team on another
 * competition, fall back to the sealed feed name — the trust boundary has
 * already reduced it to a bounded human label.
 */
function rosterPinned(t: Team, pin: boolean): Team {
  if (!pin) return t;
  const { team } = lookupTeam(t.code);
  return team ? { ...t, name: team.name, flag: team.flag } : t;
}

function line(m: Match, flags: boolean, pin: boolean): string {
  const minute = m.status === 'HT' ? 'half-time' : m.minute ? `${m.minute}'` : 'live';
  const h = rosterPinned(m.home, pin);
  const a = rosterPinned(m.away, pin);
  const home = flags ? withFlag(h.name, h.flag, 'home') : h.name;
  const away = flags ? withFlag(a.name, a.flag, 'away') : a.name;
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
  const flags = opts.flags ?? true;
  const pin = opts.defaultCompetition ?? true;
  const kind = opts.teamKind ?? defaultTeamKind(opts.defaultCompetition);

  const liveList = liveMatchesFromCache(state, now.getTime(), kind);
  // A malformed cache record does not establish that live scores are down.
  // Outside a match window the hook's contract is still zero added tokens.
  if (liveList.items.length === 0) return '';
  // The user's team first, if any; the others kept (the one ambient rule).
  const live: Match[] = pickAmbientMatch(liveList.items, opts.pick);

  // Bound the RECORD COUNT. This text is injected into Claude's context on
  // every prompt submit, and while each field is capped, nothing capped how
  // many matches a poisoned cache could list — a 500-record file produced
  // 2,002 lines of context. `renderPrompt` has had this cap (CLAUDINHO_MAX);
  // the hook, the surface that actually writes into the model, had none.
  const shown = live.slice(0, MAX_HOOK_MATCHES);
  const overflow = live.length - shown.length;
  const lines = shown.map((mm) => line(mm, flags, pin)).join('\n');
  // Truncation is stated, never silent (English-only, like the rest of the
  // hook — see the ambient-surface carve-out in AGENTS.md).
  const more = !liveList.complete
    ? '\n(more live matches may not be shown)'
    : overflow > 0
      ? `\n(+${overflow} more not shown)`
      : '';
  // Labelled as live context so the model treats it as ambient info, not an
  // instruction. Kept terse to minimise token cost.
  return boundContext(`[Claudinho — live football scores right now]\n${lines}`, more);
}
