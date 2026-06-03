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
import { scoreline, type Match } from '@claudinho/core';
import { readState } from './cache';
import { liveMatchesFromCache } from './statusline';

export interface HookOpts {
  /** Preferred team code (e.g. "MEX") — listed first. */
  team?: string;
  now?: Date;
}

function line(m: Match): string {
  const minute = m.status === 'HT' ? 'half-time' : m.minute ? `${m.minute}'` : 'live';
  return `${m.home.flag} ${m.home.name} ${scoreline(m)} ${m.away.name} ${m.away.flag} (${minute})`;
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

  let live = liveMatchesFromCache(state, now.getTime());
  if (live.length === 0) return '';

  // Surface the user's team first, if any.
  if (team) {
    live = [...live].sort((a, b) => {
      const aHas = a.home.code === team || a.away.code === team ? 0 : 1;
      const bHas = b.home.code === team || b.away.code === team ? 0 : 1;
      return aHas - bHas;
    });
  }

  const lines = live.map(line).join('\n');
  // Labelled as live context so the model treats it as ambient info, not an
  // instruction. Kept terse to minimise token cost.
  return `[Claudinho — live football scores right now]\n${lines}`;
}

/** Read the cache and render the hook context (the runtime entry). */
export function hookContext(opts: HookOpts = {}): string {
  return renderHook(readState(), opts);
}
