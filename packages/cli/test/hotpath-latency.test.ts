/**
 * HOT-PATH BUDGET GUARD — the <150ms statusline constraint, made executable.
 *
 * Two contracts:
 *  1. The built `prompt` binary, fed a fresh seeded cache, completes well inside
 *     an order-of-magnitude bound on its FASTEST of N runs. The bound is
 *     deliberately loose (runners are noisy); its job is to catch a heavy
 *     top-level import or accidental sync work sneaking onto the hot path,
 *     not to certify 150ms.
 *  2. In-process, `cmdPrompt`/`cmdHook` with a FRESH cache perform zero network
 *     calls and spawn zero refreshers — the hot path is cache-read + render only.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Match } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from '../src/cache';
import { cmdHook, cmdPrompt } from '../src/commands';
import type { CliConfig } from '../src/config';
import * as cursorPayload from '../src/cursorPayload';
import { makeT } from '../src/i18n';

// Only `spawn` is stubbed — `execFileSync` (used to run the real binary below)
// stays real via the importOriginal spread.
vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(() => ({ unref() {} })) };
});

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'index.js');

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return {
    lang: 'en',
    tz: undefined,
    json: false,
    color: false,
    source: 'espn',
    flavor: 'off',
    markets: true,
    ...over,
  };
}

function liveMex(now: Date): Match {
  return {
    id: '760491',
    stage: 'GROUP',
    group: 'A',
    kickoff: now.toISOString(),
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'LIVE',
    minute: 30,
    score: { home: 1, away: 0 },
    updatedAt: now.toISOString(),
  };
}

/** Fresh on BOTH cadences (live + fixtures) → the hot path has nothing to refresh. */
function seedFreshCache(): void {
  const now = new Date();
  writeState({
    updatedAt: now.toISOString(),
    live: [liveMex(now)],
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
    fixtures: [liveMex(now)],
    fixturesUpdatedAt: now.toISOString(),
  });
}

let dir: string;
const origEnv = {
  cache: process.env.XDG_CACHE_HOME,
  comp: process.env.CLAUDINHO_COMPETITION,
  team: process.env.CLAUDINHO_TEAM,
  flags: process.env.CLAUDINHO_FLAGS,
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-latency-'));
  process.env.XDG_CACHE_HOME = dir;
  delete process.env.CLAUDINHO_COMPETITION;
  delete process.env.CLAUDINHO_TEAM;
  process.env.CLAUDINHO_FLAGS = 'on';
  // In-process cmdPrompt must never read real stdin — readFileSync(0) hangs on
  // Windows workers (open writerless pipe). The spawned-binary test below
  // exercises the real drain with an explicit EOF (`input: ''`).
  vi.spyOn(cursorPayload, 'readCursorPayload').mockReturnValue(undefined);
  vi.mocked(spawn).mockClear();
});
afterEach(() => {
  const { cache, comp, team, flags } = origEnv;
  if (cache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = cache;
  if (comp === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = comp;
  if (team === undefined) delete process.env.CLAUDINHO_TEAM;
  else process.env.CLAUDINHO_TEAM = team;
  if (flags === undefined) delete process.env.CLAUDINHO_FLAGS;
  else process.env.CLAUDINHO_FLAGS = flags;
  rmSync(dir, { recursive: true, force: true });
});

describe('hot path performs no I/O beyond the cache read (in-process)', () => {
  it('cmdPrompt/cmdHook with a fresh cache: zero fetches, zero refresher spawns', () => {
    seedFreshCache();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const outSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      cmdPrompt({ cfg: cfg(), t: makeT('en') });
      cmdHook({ cfg: cfg(), t: makeT('en') });
    } finally {
      outSpy.mockRestore();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe.skipIf(!existsSync(DIST))('built `prompt` stays inside the latency budget', () => {
  // Loose bounds absorb CI-runner noise while still catching an order-of-magnitude
  // regression (the real budget is <150ms; warm p50 measured ~50ms on dev hardware).
  const BOUND_MS = process.platform === 'win32' ? 1500 : 500;

  // Generous it-timeout: under parallel load the 10 sequential runs can take
  // >5s AGGREGATE (vitest's default) without any single run being slow. A truly
  // hung binary still fails loud via execFileSync's own 15s per-run timeout.
  it(`fastest of 10 runs < ${BOUND_MS}ms and renders the seeded match`, { timeout: 120_000 }, () => {
    seedFreshCache();
    const env = { ...process.env }; // carries XDG_CACHE_HOME + CLAUDINHO_FLAGS from beforeEach
    const times: number[] = [];
    let lastOut = '';
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      lastOut = execFileSync(process.execPath, [DIST, 'prompt'], {
        env,
        encoding: 'utf8',
        input: '', // immediate stdin EOF — the Cursor-payload drain must not block
        timeout: 15_000,
      });
      times.push(performance.now() - t0);
    }
    expect(lastOut).toContain('🇲🇽'); // it actually rendered from the seeded cache
    // MIN of the runs, not the median: co-scheduling noise (e.g. `pnpm -r test`
    // running three suites on one machine) only ever ADDS time, so under load the
    // median measures the machine, not the binary (observed: median 890ms during
    // the 0.9.0 release gate while passing in isolation). The fastest run is the
    // closest observable to the binary's intrinsic cost, and a structural
    // regression — a heavy top-level import or sync work on the hot path —
    // inflates every run including the fastest, so min still trips the guard.
    const fastest = Math.min(...times);
    expect(fastest, `run times: ${times.map((t) => t.toFixed(0)).join(', ')}ms`).toBeLessThan(
      BOUND_MS,
    );
  });
});
