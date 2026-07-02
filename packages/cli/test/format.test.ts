import { describe, expect, it } from 'vitest';
import { displayWidth, matchFlavor, type Match } from '@claudinho/core';
import { dataSource, matchLine, painterFor } from '../src/format';
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

// Generic-flair wiring is tested on a NON-MEX match: MEX intentionally overrides
// the genre flair with its "¿Y si sí?" rally cry (see matchLine), so it can't be
// used to verify that the ordinary localized commentary flows through.
const liveNonMex = (over: Partial<Match> = {}): Match =>
  liveMatch({ home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' }, ...over });
const render = (c: CliConfig) => matchLine(liveNonMex(), c, makeT(c.lang), painterFor(c));

describe('matchLine — flavor wiring', () => {
  it('appends the localized flair at flavor=full', () => {
    const c = cfg({ flavor: 'full' });
    const flair = matchFlavor(liveNonMex(), { level: 'full', locale: 'en' });
    expect(flair).not.toBe('');
    expect(render(c)).toContain(flair);
  });

  it('omits flair at flavor=off', () => {
    const flair = matchFlavor(liveNonMex(), { level: 'full', locale: 'en' });
    expect(render(cfg({ flavor: 'off' }))).not.toContain(flair);
  });

  it('localizes the flair to the configured language', () => {
    const es = render(cfg({ flavor: 'full', lang: 'es' }));
    expect(es).toContain(matchFlavor(liveNonMex(), { level: 'full', locale: 'es' }));
  });

  it('drops flag emoji when flags are off (names only)', () => {
    const line = matchLine(liveMatch(), cfg(), makeT('en'), painterFor(cfg()), false);
    expect(line).toContain('Mexico');
    expect(line).toContain('South Africa');
    expect(line).not.toMatch(/\uD83C[\uDDE6-\uDDFF]/);
  });

  it('renders the penalty shootout score in the line (surface inherits scoreline)', () => {
    const pens = liveMatch({
      status: 'FT',
      minute: undefined,
      score: { home: 1, away: 1 },
      shootout: { home: 3, away: 4 },
    });
    expect(matchLine(pens, cfg(), makeT('en'), painterFor(cfg()))).toContain('1(3)–1(4)');
  });
});

describe('dataSource — localized live-data attribution', () => {
  const c = painterFor(cfg()); // color: false → plain text
  it('localizes the live-data prefix via core i18n', () => {
    expect(dataSource('espn', 'es', c)).toBe('Datos en vivo: ESPN');
    expect(dataSource('espn', 'pt', c)).toBe('Dados ao vivo: ESPN');
    expect(dataSource('espn', 'en', c)).toBe('Live data: ESPN');
  });
  it('returns an empty string when there is no live source', () => {
    expect(dataSource(undefined, 'es', c)).toBe('');
  });
});

describe('matchLine — display-width alignment (tag-sequence flags)', () => {
  const ENGLAND_FLAG = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';

  it("England's score column lines up with a regional-flag row", () => {
    const c = cfg({ flavor: 'off' });
    const mex = matchLine(liveMatch(), c, makeT('en'), painterFor(c));
    const eng = matchLine(
      liveMatch({ home: { code: 'ENG', name: 'England', flag: ENGLAND_FLAG } }),
      c,
      makeT('en'),
      painterFor(c),
    );
    const widthBefore = (line: string) => displayWidth(line.slice(0, line.indexOf('1–0')));
    expect(widthBefore(eng)).toBe(widthBefore(mex));
  });
});
