import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdToday, cmdLive, InputError } from '../src/commands';
import { makeT } from '../src/i18n';
import type { CliConfig } from '../src/config';

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: undefined, json: true, color: false, source: 'espn', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en') });

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
});

describe('timezone warning (L2)', () => {
  it('warns to stderr on an invalid --tz but does not throw', async () => {
    // cmdLive hits the network adapter; allow it to degrade gracefully (no live
    // matches) — we only assert the warning fired.
    await cmdLive(ctx({ tz: 'Totally/Bogus' }));
    const warned = errSpy.mock.calls.some((c) => String(c[0]).includes('Unknown timezone'));
    expect(warned).toBe(true);
  });

  it('does not warn for a valid --tz', async () => {
    await cmdLive(ctx({ tz: 'America/Mexico_City' }));
    const warned = errSpy.mock.calls.some((c) => String(c[0]).includes('Unknown timezone'));
    expect(warned).toBe(false);
  });
});
