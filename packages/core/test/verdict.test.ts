/**
 * 0.11 PR 2.0b — one place where a verdict becomes output.
 *
 * A "verdict" is something a result says about ITSELF that changes what a
 * reader may conclude: "this is not available for this competition" is not "no
 * fixture found". Twice in 0.10.1 a surface printed a verdict in its text and
 * dropped it from the structured twin (`share --json` lost `partial`,
 * `markets --json` lost `unsupported`), and the MCP tools still drop
 * `unsupported` from `data` today. Each time the cause was the same: every
 * surface forwarded each verdict by hand.
 *
 * `verdictExtras` (the structured keys) and `verdictNotice` (the localized
 * sentence) are the two functions every surface now calls, so a verdict added
 * here reaches all of them, and the share cards CLI and MCP paste are assembled
 * once, in core.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { marketDisplayable } from '../src/markets/normalize';
import {
  bracketShareCard,
  dateShareCard,
  liveShareCard,
  matchShareCard,
  nextShareCard,
  tableShareCard,
} from '../src/share/cards';
import type { MarketSignal } from '../src/markets/types';
import type { Match } from '../src/types';
import { verdictExtras, verdictNotice } from '../src/verdict';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const match: Match = {
  id: '760415',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00.000Z',
  venue: 'Estadio Banorte',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
  status: 'SCHEDULED',
  updatedAt: '2026-06-10T00:00:00.000Z',
};
const noMarket = { signals: new Map<string, MarketSignal>(), complete: true };
const ctx = { tz: 'UTC', locale: 'en' };

describe('verdictExtras — the structured keys, from one place', () => {
  it('carries a verdict a result states, and nothing when it states none', () => {
    expect(verdictExtras({ unsupported: true })).toEqual({ unsupported: true });
    expect(verdictExtras({})).toEqual({});
    expect(verdictExtras({ unsupported: undefined })).toEqual({});
  });

  it('takes only verdicts: the rest of a result is not its business', () => {
    const result = { fixture: undefined, degraded: false, source: 'espn', unsupported: true as const };
    expect(verdictExtras(result)).toEqual({ unsupported: true });
    const healthy: { degraded: boolean; source: string; unsupported?: boolean } = { degraded: true, source: 'espn' };
    expect(Object.keys(verdictExtras(healthy))).toEqual([]);
  });
});

describe('verdictNotice — the sentence, in the reader’s language', () => {
  it('is the same localized sentence for every surface', () => {
    expect(verdictNotice({ unsupported: true }, 'en')).toBe('Not available for this competition yet.');
    expect(verdictNotice({ unsupported: true }, 'es')).toBe('Aún no disponible para esta competición.');
    expect(verdictNotice({ unsupported: true }, 'pt')).toBe('Ainda não disponível para esta competição.');
    expect(verdictNotice({ unsupported: true }, 'fr')).toBe('Pas encore disponible pour cette compétition.');
  });

  it('is absent when the result states no verdict', () => {
    expect(verdictNotice({}, 'en')).toBeUndefined();
    const outage: { degraded: boolean; unsupported?: boolean } = { degraded: true };
    expect(verdictNotice(outage, 'en')).toBeUndefined();
  });
});

describe('share cards — assembled once, for the CLI and the MCP server alike', () => {
  it('next: a fixture', () => {
    const card = nextShareCard({ fixture: match, degraded: false, source: 'espn' }, 'MEX', noMarket, ctx);
    expect(card).toMatchObject({ kind: 'next', target: 'next', team: 'MEX', verdict: {} });
    expect(card.input).toMatchObject({
      title: 'Next up for Mexico',
      matches: [match],
      source: 'espn',
      degraded: false,
      emptyNote: 'No upcoming fixture found for MEX.',
      installLine: 'npx @claudinho/cli next MEX',
      tz: 'UTC',
      locale: 'en',
    });
  });

  it('next: an outage never reads as "no fixture", and an unsupported competition says so', () => {
    const down = nextShareCard({ fixture: undefined, degraded: true }, 'MEX', noMarket, ctx);
    expect(down.input.title).toBe('Next up for MEX');
    expect(down.input.emptyNote).toBe("Couldn't reach the data provider — no upcoming fixture confirmed for MEX.");
    expect(down.verdict).toEqual({});

    const off = nextShareCard({ fixture: undefined, degraded: false, unsupported: true }, 'ARS', noMarket, {
      tz: 'UTC',
      locale: 'es',
    });
    expect(off.input.emptyNote).toBe('Aún no disponible para esta competición.');
    expect(off.verdict).toEqual({ unsupported: true });
  });

  it('match: found, not found, unsupported', () => {
    const found = matchShareCard({ match, degraded: false, source: 'espn' }, '760415', noMarket, ctx);
    expect(found).toMatchObject({ kind: 'match', target: '760415', verdict: {} });
    expect(found.input).toMatchObject({
      title: 'Match pulse',
      matches: [match],
      emptyNote: 'No match found with id 760415.',
      installLine: 'npx @claudinho/cli match 760415',
    });
    const off = matchShareCard({ match: undefined, degraded: false, unsupported: true }, '760415', noMarket, ctx);
    expect(off.input.matches).toEqual([]);
    expect(off.input.emptyNote).toBe('Not available for this competition yet.');
    expect(off.verdict).toEqual({ unsupported: true });
  });

  it('a date: today or an explicit day, with a caller-bounded list', () => {
    const today = dateShareCard(
      { date: '2026-06-11', explicit: false, matches: [match], degraded: false, source: 'espn' },
      noMarket,
      ctx,
    );
    expect(today).toMatchObject({ kind: 'today', target: '2026-06-11' });
    expect(today.input.title).toBe("Today's matches · Jun 11");
    expect(today.input.emptyNote).toBe('No matches scheduled for Jun 11.');
    expect(today.input.installLine).toBe('npx @claudinho/cli today');

    const explicit = dateShareCard(
      { date: '2026-06-11', explicit: true, matches: [], degraded: true, titleSuffix: ' (showing 20 of 31)' },
      noMarket,
      ctx,
    );
    expect(explicit.input.title).toBe('Matches · Jun 11 (showing 20 of 31)');
    expect(explicit.input.degraded).toBe(true);
  });

  it('live: nothing on, and a feed that is down, are different cards', () => {
    const quiet = liveShareCard({ matches: [], degraded: false, source: 'espn' }, ctx);
    expect(quiet).toMatchObject({ kind: 'live', target: 'live' });
    expect(quiet.input).toMatchObject({
      title: 'Live match pulse',
      emptyNote: 'No matches in play right now.',
      installLine: 'npx @claudinho/cli live',
    });
    const down = liveShareCard({ matches: [], degraded: true }, ctx, { titleSuffix: ' (showing 0 of 0)' });
    expect(down.input.emptyNote).toBe("Live scores unavailable right now — couldn't reach the data provider.");
    expect(down.input.title).toBe('Live match pulse (showing 0 of 0)');
  });

  it('a table: no attribution when degraded, and the empty note names what is missing', () => {
    const live = tableShareCard({ tables: [], degraded: false, source: 'espn' }, 'Z');
    expect(live.input).toMatchObject({ source: 'espn', installLine: 'npx @claudinho/cli table Z', emptyNote: 'No group Z.' });
    const all = tableShareCard({ tables: [], degraded: false, source: 'espn' }, undefined);
    expect(all.input).toMatchObject({ installLine: 'npx @claudinho/cli table', emptyNote: 'No standings available.' });
    const down = tableShareCard({ tables: [], degraded: true }, 'A');
    expect(down.input.source).toBeUndefined();
    expect(down.input.emptyNote).toBe('Live standings unavailable.');
  });

  it('a bracket: the unsupported verdict rides on the card', () => {
    const view = { stages: [], degraded: false, standingsDegraded: false };
    const wc = bracketShareCard({ view, degraded: false, standingsDegraded: false, source: 'espn' }, 'QF', 'en');
    expect(wc.input).toMatchObject({ source: 'espn', installLine: 'npx @claudinho/cli bracket QF' });
    expect(wc.verdict).toEqual({});
    const off = bracketShareCard(
      { view: { ...view, unsupported: true }, degraded: false, standingsDegraded: false, unsupported: true },
      undefined,
      'fr',
    );
    expect(off.input.installLine).toBe('npx @claudinho/cli bracket');
    expect(off.input.emptyNote).toBe('Pas encore disponible pour cette compétition.');
    expect(off.verdict).toEqual({ unsupported: true });
  });
});

describe('one definition of each rule the two surfaces used to copy', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.ts$/.test(name) ? [path] : [];
    });
  }
  const hits = (pkg: string, pattern: RegExp): string[] =>
    sources(join(PACKAGES, pkg, 'src'))
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(PACKAGES, f).split(sep).join('/'));

  it('whether a market signal may be displayed is decided in core', () => {
    expect(typeof marketDisplayable).toBe('function');
    expect(hits('cli', /function marketDisplayable\b/)).toEqual([]);
    expect(hits('mcp', /function marketDisplayable\b/)).toEqual([]);
  });

  it('no surface forwards a verdict by hand', () => {
    // The pattern that was copied to every emit site, and forgotten at some.
    const byHand = /unsupported\s*\?\s*\{\s*unsupported:\s*true\s*\}/;
    expect(hits('cli', byHand)).toEqual([]);
    expect(hits('mcp', byHand)).toEqual([]);
  });

  it('no surface writes the "not available" sentence itself', () => {
    const sentence = /['"`]competition\.unsupported['"`]/;
    expect(hits('cli', sentence)).toEqual([]);
    expect(hits('mcp', sentence)).toEqual([]);
  });
});
