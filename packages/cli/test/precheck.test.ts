import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdToday, cmdLive, InputError } from '../src/commands';
import { makeT } from '../src/i18n';
import type { CliConfig } from '../src/config';
import type { Match, ProviderAdapter } from '@claudinho/core';

/** A fake adapter so these tests never touch the network. */
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
  return { lang: 'en', tz: undefined, json: true, color: false, source: 'espn', flavor: 'full', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter: fakeAdapter,
});

// Keep stdout/stderr quiet and inspectable.
const outSpy = vi.spyOn(process.stdout, 'write');
const errSpy = vi.spyOn(process.stderr, 'write');
beforeEach(() => {
  outSpy.mockImplementation(() => true);
  errSpy.mockImplementation(() => true);
});
afterEach(() => {
  outSpy.mockReset();
  errSpy.mockReset();
});

describe('date validation (L1)', () => {
  it('rejects a malformed date with InputError before any network call', async () => {
    await expect(cmdToday('2026-6-11', ctx())).rejects.toBeInstanceOf(InputError);
    await expect(cmdToday('13/06/2026', ctx())).rejects.toBeInstanceOf(InputError);
    await expect(cmdToday('2026-02-30', ctx())).rejects.toBeInstanceOf(InputError); // rollover
  });

  it('the InputError message names the bad value and the expected format', async () => {
    await expect(cmdToday('nope', ctx())).rejects.toThrowError(/Invalid date nope.*YYYY-MM-DD/);
  });

  it('accepts a valid date (no throw)', async () => {
    await expect(cmdToday('2026-06-11', ctx())).resolves.toBeUndefined();
  });
});

describe('timezone warning (L2)', () => {
  it('warns to stderr on an invalid --tz but does not throw', async () => {
    await cmdLive(ctx({ tz: 'Totally/Bogus' }));
    const warned = errSpy.mock.calls.some((c) => String(c[0]).includes('Unknown timezone'));
    expect(warned).toBe(true);
  });

  it('does not warn for a valid --tz', async () => {
    await cmdLive(ctx({ tz: 'America/Mexico_City' }));
    const warned = errSpy.mock.calls.some((c) => String(c[0]).includes('Unknown timezone'));
    expect(warned).toBe(false);
  });

  it('keeps the tz warning on stderr only — stdout stays clean JSON', async () => {
    await cmdLive(ctx({ tz: 'Bogus/Zone', json: true }));
    // Every stdout write must be parseable JSON (no warning leaked in).
    const stdout = outSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});

describe('language warning (consistency with tz)', () => {
  it('warns to stderr when an explicit --lang is unsupported', async () => {
    await cmdLive(ctx({ langRequestedUnsupported: 'de' }));
    const warned = errSpy.mock.calls.some((c) => String(c[0]).includes('Unsupported language'));
    expect(warned).toBe(true);
  });

  it('does not warn when lang is supported (flag unset)', async () => {
    await cmdLive(ctx());
    const warned = errSpy.mock.calls.some((c) => String(c[0]).includes('Unsupported language'));
    expect(warned).toBe(false);
  });
});
