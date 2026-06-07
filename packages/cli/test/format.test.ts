import { describe, expect, it } from 'vitest';
import { matchFlavor, type Match } from '@claudinho/core';
import { matchLine, painterFor } from '../src/format';
import { makeT } from '../src/i18n';
import type { CliConfig } from '../src/config';

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'full', ...over };
}
function liveMatch(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    city: 'Mexico City',
    country: 'Mexico',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'LIVE',
    minute: 67,
    score: { home: 1, away: 0 },
    updatedAt: '2026-06-11T20:07Z',
    ...over,
  };
}

const render = (c: CliConfig) => matchLine(liveMatch(), c, makeT(c.lang), painterFor(c));

describe('matchLine — flavor wiring', () => {
  it('appends the localized flair at flavor=full', () => {
    const c = cfg({ flavor: 'full' });
    const flair = matchFlavor(liveMatch(), { level: 'full', locale: 'en' });
    expect(flair).not.toBe('');
    expect(render(c)).toContain(flair);
  });

  it('omits flair at flavor=off', () => {
    const flair = matchFlavor(liveMatch(), { level: 'full', locale: 'en' });
    expect(render(cfg({ flavor: 'off' }))).not.toContain(flair);
  });

  it('localizes the flair to the configured language', () => {
    const es = render(cfg({ flavor: 'full', lang: 'es' }));
    expect(es).toContain(matchFlavor(liveMatch(), { level: 'full', locale: 'es' }));
  });
});
