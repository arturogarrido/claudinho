import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldRefresh } from '../src/refresh';

// A time well outside any World Cup window (tournament starts 2026-06-11).
const PRE_WC = new Date('2026-06-04T16:00:00Z').getTime();

let dir: string;
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-refresh-'));
  process.env.XDG_CACHE_HOME = dir; // empty cache → stale → would refresh if windowed
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('shouldRefresh — competition-aware live window', () => {
  it('does NOT refresh outside a World Cup window (default competition)', () => {
    // No CLAUDINHO_COMPETITION → gated on the static WC schedule, which has no
    // match on 2026-06-04, so we must not poll.
    expect(shouldRefresh(PRE_WC)).toBe(false);
  });

  it('DOES refresh for a non-default competition (e.g. friendlies)', () => {
    // The WC schedule can't describe friendly windows, so the gate is bypassed
    // and a stale cache is allowed to refresh.
    process.env.CLAUDINHO_COMPETITION = 'fifa.friendly';
    expect(shouldRefresh(PRE_WC)).toBe(true);
  });
});
