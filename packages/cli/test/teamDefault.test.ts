import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allFixtures, type Match, type ProviderAdapter } from '@claudinho/core';
import { cmdNext, cmdShare, InputError } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const fakeAdapter: ProviderAdapter = {
  name: 'fake',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', flavor: 'off', markets: false, ...over };
}
const ctx = () => ({ cfg: cfg(), t: makeT('en'), adapter: fakeAdapter });

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const json = () => JSON.parse(writes.join(''));

describe('CLAUDINHO_TEAM fallback (next / share next)', () => {
  const TEAM = allFixtures()[0]!.home.code;
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.CLAUDINHO_TEAM;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDINHO_TEAM;
    else process.env.CLAUDINHO_TEAM = prev;
  });

  it('cmdNext falls back to the env team', async () => {
    process.env.CLAUDINHO_TEAM = TEAM.toLowerCase();
    await cmdNext(undefined, ctx());
    expect((json() as { team: string }).team).toBe(TEAM.toUpperCase());
  });

  it('cmdNext still errors with no arg and no env', async () => {
    delete process.env.CLAUDINHO_TEAM;
    await expect(cmdNext(undefined, ctx())).rejects.toBeInstanceOf(InputError);
  });

  it('cmdShare next falls back to the env team', async () => {
    process.env.CLAUDINHO_TEAM = TEAM;
    await cmdShare('next', undefined, {}, ctx());
    expect((json() as { team: string }).team).toBe(TEAM.toUpperCase());
  });
});

describe('team-arg name resolution (next / share next accept names, not just codes)', () => {
  it('resolves a nation name to its code', async () => {
    await cmdNext('mexico', ctx());
    expect((json() as { team: string }).team).toBe('MEX');
  });

  it('resolves an alias (Holland → NED) via share next too', async () => {
    await cmdShare('next', 'holland', {}, ctx());
    expect((json() as { team: string }).team).toBe('NED');
  });

  it('still accepts a raw 3-letter code (backward compatible)', async () => {
    await cmdNext('mex', ctx());
    expect((json() as { team: string }).team).toBe('MEX');
  });

  it('errors (with candidates) on an ambiguous name rather than guessing', async () => {
    await expect(cmdNext('south', ctx())).rejects.toBeInstanceOf(InputError);
  });

  it('errors on an unknown non-code query', async () => {
    await expect(cmdNext('zzzzz', ctx())).rejects.toBeInstanceOf(InputError);
  });
});
