/**
 * `cmdHook` must tell `renderHook` which competition the cache describes. A
 * test on `renderHook` alone would stay green if the command stopped passing
 * the flag (the rule-24 lesson: pin the CALL, not just the function), so this
 * one drives the real command against a seeded cache file.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from '../src/cache';
import { cmdHook } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const cfg: CliConfig = { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off' };

/** A LaLiga match in play: ESPN's Espanyol is `ESP`, which is also Spain's code. */
function espanyolLive(now: Date): Match {
  return {
    id: '401879999',
    stage: 'FRIENDLY',
    kickoff: new Date(now.getTime() - 45 * 60_000).toISOString(),
    venue: 'RCDE Stadium',
    home: { code: 'ESP', name: 'Espanyol', flag: '🏳️' },
    away: { code: 'GIR', name: 'Girona', flag: '🏳️' },
    status: 'LIVE',
    minute: 44,
    score: { home: 1, away: 0 },
    updatedAt: now.toISOString(),
  };
}

const ENV = ['CLAUDINHO_COMPETITION', 'XDG_CACHE_HOME', 'CLAUDINHO_TEAM'] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
let dir: string;
let writes: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = mkdtempSync(join(tmpdir(), 'claudinho-hook-comp-'));
  process.env.XDG_CACHE_HOME = dir;
  delete process.env.CLAUDINHO_TEAM;
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('cmdHook — the roster is pinned only for the competition it describes', () => {
  it('renders a LaLiga club under its own name, never as the nation sharing its code', () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    const now = new Date();
    writeState({
      updatedAt: now.toISOString(),
      live: [espanyolLive(now)],
      degraded: false,
      source: 'espn',
      competition: 'esp.1',
    });
    cmdHook({ cfg, t: makeT('en') });
    const out = writes.join('');
    expect(out).toContain('Espanyol 1–0 Girona');
    expect(out).not.toContain('Spain');
  });

  it('still pins a default-competition code to the World Cup roster', () => {
    delete process.env.CLAUDINHO_COMPETITION;
    const now = new Date();
    writeState({
      updatedAt: now.toISOString(),
      live: [{ ...espanyolLive(now), home: { code: 'ESP', name: 'Espanyol', flag: '🇪🇸' } }],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    });
    cmdHook({ cfg, t: makeT('en') });
    const out = writes.join('');
    expect(out).toContain('Spain 1–0');
    expect(out).not.toContain('Espanyol');
  });
});
