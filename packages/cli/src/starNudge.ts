/**
 * Star CTA plumbing — the npm→GitHub conversion nudge. STRICTLY off the hot path:
 * the statusline (`prompt`) and hook code paths never CALL this (commands.ts
 * imports it, but only the interactive commands invoke it). The footer nudge is shown
 * only on interactive, TTY, non-JSON runs, on every Nth invocation, and is
 * suppressible with CLAUDINHO_NO_STAR. Everything here is best-effort and never
 * throws — a CTA must never break or slow a command.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Canonical repo URL — the single place every star CTA points to. */
export const REPO_URL = 'https://github.com/arturogarrido/claudinho';

const NUDGE_EVERY = 5;

function counterPath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'claudinho', 'runs.json');
}

/** Show the star nudge on every Nth interactive run. Pure → unit-testable. */
export function shouldNudge(runCount: number, every: number = NUDGE_EVERY): boolean {
  return runCount > 0 && runCount % every === 0;
}

/**
 * Best-effort interactive-run counter: read → increment → persist; returns the
 * new count, or undefined if the store is unavailable (then we simply never
 * nudge). Never throws.
 */
export function bumpRunCount(path: string = counterPath()): number | undefined {
  try {
    let count = 0;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { count?: number };
      if (typeof raw.count === 'number' && Number.isFinite(raw.count)) count = raw.count;
    } catch {
      count = 0; // missing/corrupt → start fresh
    }
    count += 1;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ count }), 'utf8');
    return count;
  } catch {
    return undefined;
  }
}
