import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, MarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from '../src/cache';
import { cmdHook, cmdPrompt } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

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

/** A market provider whose every method is a spy that must never run here. */
function spyProvider() {
  const findSignal = vi.fn(async () => undefined);
  const findSignals = vi.fn(async () => new Map());
  const provider = { name: 'spy', findSignal, findSignals } as unknown as MarketProvider;
  return { provider, findSignal, findSignals };
}

function liveMatch(): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'LIVE',
    minute: 67,
    score: { home: 1, away: 0 },
    updatedAt: '2026-06-11T20:07Z',
  };
}

let dir: string;
const origCache = process.env.XDG_CACHE_HOME;
const origComp = process.env.CLAUDINHO_COMPETITION;
const origTeam = process.env.CLAUDINHO_TEAM;
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-hot-'));
  process.env.XDG_CACHE_HOME = dir;
  delete process.env.CLAUDINHO_COMPETITION;
  delete process.env.CLAUDINHO_TEAM;
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  // Fresh cache so the hot path renders without spawning a refresher.
  writeState({
    updatedAt: new Date().toISOString(),
    live: [liveMatch()],
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (origCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = origCache;
  if (origComp === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = origComp;
  if (origTeam === undefined) delete process.env.CLAUDINHO_TEAM;
  else process.env.CLAUDINHO_TEAM = origTeam;
  rmSync(dir, { recursive: true, force: true });
});

describe('hot path never consults market data', () => {
  it('cmdPrompt and cmdHook do not call a market provider', () => {
    const { provider, findSignal, findSignals } = spyProvider();
    const ctx = { cfg: cfg(), t: makeT('en'), marketProvider: provider };
    cmdPrompt(ctx);
    cmdHook(ctx);
    expect(findSignal).not.toHaveBeenCalled();
    expect(findSignals).not.toHaveBeenCalled();
  });

  it('statusline/hook output renders the score but no market content', () => {
    cmdPrompt({ cfg: cfg(), t: makeT('en') });
    cmdHook({ cfg: cfg(), t: makeT('en') });
    const o = writes.join('');
    expect(o).toContain('🇲🇽'); // the live match did render
    expect(o).not.toMatch(/prediction markets|informational only|polymarket|%/i);
    // Share-only copy (hashtag, install cue, snippet disclaimer) must never
    // leak onto the statusline/hook hot path either.
    expect(o).not.toMatch(/#VibingLaVidaLoca|Try it:|Independent fan project/i);
  });
});
