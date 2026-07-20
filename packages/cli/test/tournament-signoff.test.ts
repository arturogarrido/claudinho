import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive, cmdNext, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { REPO_URL } from '../src/starNudge';
import type { ProviderAdapter } from '@claudinho/core';

/**
 * Post-tournament sign-off on the interactive score commands. Companion to the
 * statusline test: the hot path signs off WITHOUT a CTA, these surfaces sign off
 * WITH one — that split is the AGENTS.md "CTAs are interactive-only" invariant.
 */

// Past the bundled final + its extra-time window → the real schedule is exhausted.
const AFTER = new Date('2026-08-01T12:00:00Z');
// Group stage: the tournament is very much not over.
const DURING = new Date('2026-06-20T03:00:00Z');

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return {
    lang: 'en',
    tz: 'UTC',
    json: false,
    color: false,
    source: 'espn',
    flavor: 'off',
    ...over,
  };
}

/** Offline adapter: no fixtures, no live — post-tournament reality, zero network. */
const adapter = {
  name: 'espn',
  fetchWindow: async () => [],
  fetchLive: async () => [],
  fetchGroupMap: async () => ({}),
} as unknown as ProviderAdapter;

const ctx = (now: Date, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter,
  now,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
let tty: boolean | undefined;

beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  tty = process.stdout.isTTY;
  process.stdout.isTTY = true; // CTA surfaces are TTY-gated
  delete process.env.CLAUDINHO_NO_STAR;
});
afterEach(() => {
  outSpy.mockReset();
  process.stdout.isTTY = tty as boolean;
  delete process.env.CLAUDINHO_NO_STAR;
});
const text = () => writes.join('');

describe('post-tournament sign-off — interactive score commands', () => {
  it('today / live / next all sign off with the thank-you and the star CTA', async () => {
    for (const run of [
      () => cmdToday(undefined, ctx(AFTER)),
      () => cmdLive(ctx(AFTER)),
      () => cmdNext('MEX', ctx(AFTER)),
    ]) {
      writes = [];
      await run();
      const t = text();
      expect(t).toContain('The World Cup is complete. Thanks for using Claudinho.');
      expect(t).toContain('#VibingLaVidaLoca');
      expect(t).toContain('⭐ Star the project:');
      expect(t).toContain(REPO_URL);
    }
  });

  it('stays silent mid-tournament (the sign-off is not a permanent footer)', async () => {
    await cmdToday(undefined, ctx(DURING));
    expect(text()).not.toContain('The World Cup is complete');
  });

  it('never appears in --json (machine output stays clean)', async () => {
    await cmdToday(undefined, ctx(AFTER, { json: true }));
    const t = text();
    expect(t).not.toContain('The World Cup is complete');
    expect(t).not.toContain(REPO_URL);
  });

  it('CLAUDINHO_NO_STAR drops the CTA but keeps the explanation', async () => {
    // The thank-you explains WHY the command is empty — that is product state,
    // not marketing, so it survives the opt-out; only the star ask is suppressed.
    process.env.CLAUDINHO_NO_STAR = '1';
    await cmdToday(undefined, ctx(AFTER));
    const t = text();
    expect(t).toContain('The World Cup is complete');
    expect(t).not.toContain('⭐ Star the project:');
    expect(t).not.toContain(REPO_URL);
  });

  it('piped (non-TTY) output keeps the explanation, drops the CTA', async () => {
    process.stdout.isTTY = false;
    await cmdToday(undefined, ctx(AFTER));
    const t = text();
    expect(t).toContain('The World Cup is complete');
    expect(t).not.toContain(REPO_URL);
  });

  it('suppressed when CLAUDINHO_COMPETITION points at another competition', async () => {
    // The bundled schedule describes the World Cup — appending its goodbye to a
    // live alternate feed would be flatly wrong. (Set before the command runs;
    // resolveCompetition() reads the env at call time.)
    process.env.CLAUDINHO_COMPETITION = 'fifa.friendly';
    try {
      await cmdToday(undefined, ctx(AFTER));
      const t = text();
      expect(t).not.toContain('The World Cup is complete');
      expect(t).not.toContain(REPO_URL);
    } finally {
      delete process.env.CLAUDINHO_COMPETITION;
    }
  });
});

describe('post-tournament sign-off — localization (four-locale rule)', () => {
  // The statusline is EN-only by documented carve-out; these are interactive
  // surfaces, so the copy must follow the user's --lang. Regression: Spanish
  // `today --lang es` output previously ended in an English sign-off.
  const cases = [
    { lang: 'es', needle: 'El Mundial ha terminado', star: 'Dale una estrella' },
    { lang: 'pt', needle: 'A Copa do Mundo terminou', star: 'Dê uma estrela' },
    { lang: 'fr', needle: 'La Coupe du Monde est terminée', star: 'Mettez une étoile' },
    { lang: 'en', needle: 'The World Cup is complete', star: 'Star the project' },
  ] as const;

  for (const { lang, needle, star } of cases) {
    it(`signs off in ${lang}`, async () => {
      writes = [];
      await cmdToday(undefined, {
        cfg: cfg({ lang }),
        t: makeT(lang),
        adapter,
        now: AFTER,
      });
      const t = text();
      expect(t).toContain(needle);
      expect(t).toContain(star);
      // The hashtag is a fixed tag in every locale (same rule as the disclaimer).
      expect(t).toContain('#VibingLaVidaLoca');
    });
  }
});
