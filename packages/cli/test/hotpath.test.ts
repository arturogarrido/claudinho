import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, MarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cursorPayload from '../src/cursorPayload';
import { writeState } from '../src/cache';
import { cmdHook, cmdPrompt, cmdVibe } from '../src/commands';
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
const origMeta = process.env.CLAUDINHO_CURSOR_META;
const origFlags = process.env.CLAUDINHO_FLAGS;
let outSpy: ReturnType<typeof vi.spyOn>;
let writes: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-hot-'));
  process.env.XDG_CACHE_HOME = dir;
  delete process.env.CLAUDINHO_COMPETITION;
  delete process.env.CLAUDINHO_TEAM;
  process.env.CLAUDINHO_CURSOR_META = 'auto';
  // Pin flags on so these assertions hold regardless of the host terminal
  // (the flag auto-detect would otherwise switch to codes under e.g. Warp).
  process.env.CLAUDINHO_FLAGS = 'on';
  writes = [];
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  writeState({
    updatedAt: new Date().toISOString(),
    live: [liveMatch()],
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
  });
});
afterEach(() => {
  outSpy.mockRestore();
  if (origCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = origCache;
  if (origComp === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = origComp;
  if (origTeam === undefined) delete process.env.CLAUDINHO_TEAM;
  else process.env.CLAUDINHO_TEAM = origTeam;
  if (origMeta === undefined) delete process.env.CLAUDINHO_CURSOR_META;
  else process.env.CLAUDINHO_CURSOR_META = origMeta;
  if (origFlags === undefined) delete process.env.CLAUDINHO_FLAGS;
  else process.env.CLAUDINHO_FLAGS = origFlags;
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
    expect(o).toContain('🇲🇽');
    expect(o).not.toMatch(/prediction markets|informational only|polymarket|%/i);
    expect(o).not.toMatch(/#VibingLaVidaLoca|Try it:|Independent fan project/i);
  });

  it('cmdPrompt renders score first when a Cursor payload is present', () => {
    vi.spyOn(cursorPayload, 'readCursorPayload').mockReturnValue({
      model: { display_name: 'Composer 2.5' },
      context_window: { used_percentage: 12 },
    });
    cmdPrompt({ cfg: cfg(), t: makeT('en') });
    const lines = writes.join('').trimEnd().split('\n');
    expect(lines[0]).toContain('🇲🇽');
    expect(lines[1]).toContain('Composer 2.5');
    expect(lines[1]).toContain('ctx 12%');
    vi.mocked(cursorPayload.readCursorPayload).mockRestore();
  });
});

describe('CLAUDINHO_TEAM accepts a nation name on the statusline/hook (offline lookup)', () => {
  function braLive(): Match {
    return {
      id: '760420',
      stage: 'GROUP',
      group: 'C',
      kickoff: '2026-06-11T19:00Z',
      venue: 'MetLife Stadium',
      home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
      away: { code: 'MAR', name: 'Morocco', flag: '🇲🇦' },
      status: 'LIVE',
      minute: 12,
      score: { home: 0, away: 0 },
      updatedAt: '2026-06-11T20:07Z',
    };
  }

  it('cmdPrompt filters to the resolved team (CLAUDINHO_TEAM=mexico → MEX)', () => {
    writeState({
      updatedAt: new Date().toISOString(),
      live: [liveMatch(), braLive()],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    });
    process.env.CLAUDINHO_TEAM = 'mexico';
    cmdPrompt({ cfg: cfg(), t: makeT('en') });
    const o = writes.join('');
    expect(o).toContain('🇲🇽');
    expect(o).not.toContain('🇧🇷');
  });

  it('cmdHook lists the resolved team first (CLAUDINHO_TEAM=mexico)', () => {
    writeState({
      updatedAt: new Date().toISOString(),
      live: [braLive(), liveMatch()],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    });
    process.env.CLAUDINHO_TEAM = 'mexico';
    cmdHook({ cfg: cfg(), t: makeT('en') });
    const lines = writes.join('').trimEnd().split('\n');
    expect(lines[1]).toContain('Mexico');
    expect(lines[2]).toContain('Brazil');
  });

  it('cmdVibe live segment honors a resolved team name too (CLAUDINHO_TEAM=mexico)', () => {
    writeState({
      updatedAt: new Date().toISOString(),
      live: [braLive(), liveMatch()],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    });
    process.env.CLAUDINHO_TEAM = 'mexico';
    cmdVibe({ cfg: cfg({ json: true }), t: makeT('en') });
    const data = JSON.parse(writes.join('')) as { live?: string };
    expect(data.live).toContain('🇲🇽');
    expect(data.live).not.toContain('🇧🇷');
  });

  it('an unknown 3-letter value still passes through as a code (escape hatch)', () => {
    process.env.CLAUDINHO_TEAM = 'zzz'; // not in the roster → filter finds nothing
    cmdPrompt({ cfg: cfg(), t: makeT('en') });
    const o = writes.join('');
    expect(o).not.toContain('🇲🇽'); // filtered out — the code was honored, not dropped
  });
});
