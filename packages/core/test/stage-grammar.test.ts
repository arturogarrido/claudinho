/**
 * The stage comes from a written grammar over the WHOLE season slug, with the
 * competition's kind (0.11 · 2.4). Measured on the real feed on Oct 3, 2026
 * for every supported competition (see the kind table in competition.ts).
 *
 * The grammar asserts nothing it has not measured: an exact slug maps; a
 * league's season name, written per league, maps with any year in front; a
 * slug the grammar does not know is OTHER with the provider's own words; an
 * absent, malformed or oversized slug is OTHER with no label (a phase nobody
 * stated is not GROUP: the shared constructor drops a shootout under GROUP).
 * `FRIENDLY` is reached only under the friendly competition.
 */
import { describe, expect, it } from 'vitest';
import {
  isKnockoutStage,
  liveWindowMsFor,
  LIVE_WINDOW_MS,
  stageLabel,
  stageLabelI18n,
} from '../src';
import type { Match, Stage } from '../src/types';
import { parseCachedMatch, parseEspnEvent, parseEspnEvents } from '../src/trust';

const roundTrip = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

function event(slug: unknown, over: Record<string, unknown> = {}, compOver: Record<string, unknown> = {}) {
  return {
    id: '760415',
    date: '2026-10-04T14:00Z',
    season: slug === undefined ? {} : { slug },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        venue: { fullName: 'Emirates Stadium', address: { city: 'London', country: 'England' } },
        competitors: [
          { homeAway: 'home', team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' } },
          { homeAway: 'away', team: { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' } },
        ],
        ...compOver,
      },
    ],
    ...over,
  };
}

function parsed(slug: unknown, competition: string, over: Record<string, unknown> = {}, compOver: Record<string, unknown> = {}): Match {
  const r = parseEspnEvent(event(slug, over, compOver), { competition });
  if (r.kind !== 'valid') throw new Error(`not a fixture: ${JSON.stringify(r)}`);
  return r.value;
}

/** Every measured slug, with the competition it was measured on and the stage it is. */
const MEASURED: Array<[slug: string, competition: string, stage: Stage]> = [
  ['2026-27-english-premier-league', 'eng.1', 'REGULAR'],
  ['2026-27-laliga', 'esp.1', 'REGULAR'],
  ['2026-27-italian-serie-a', 'ita.1', 'REGULAR'],
  ['2026-27-german-bundesliga', 'ger.1', 'REGULAR'],
  ['torneo-apertura', 'mex.1', 'REGULAR'],
  ['torneo-clausura', 'mex.1', 'REGULAR'],
  // `regular-season` was measured on usa.1 (outside the set); the slug's
  // meaning is the provider's, and it is kept under every league.
  ['regular-season', 'mex.1', 'REGULAR'],
  ['clausura---quarterfinals', 'mex.1', 'QF'],
  ['clausura---semifinals', 'mex.1', 'SF'],
  ['clausura---finals', 'mex.1', 'F'],
  ['apertura---quarterfinals', 'mex.1', 'QF'],
  ['league-phase', 'uefa.champions', 'LEAGUE'],
  ['league-phase', 'uefa.nations', 'LEAGUE'],
  ['knockout-round-playoffs', 'uefa.champions', 'PO'],
  ['relegation-playoffs', 'uefa.nations', 'PO'],
  ['group-stage', 'fifa.world', 'GROUP'],
  ['group-stage', 'conmebol.libertadores', 'GROUP'],
  ['round-of-32', 'fifa.world', 'R32'],
  ['round-of-16', 'uefa.champions', 'R16'],
  ['quarterfinals', 'uefa.euro', 'QF'],
  ['semifinals', 'concacaf.gold', 'SF'],
  ['final', 'conmebol.america', 'F'],
  ['3rd-place-match', 'fifa.world', '3P'],
  ['friendly', 'fifa.friendly', 'FRIENDLY'],
];

describe('the measured slugs reach the stage they were measured as', () => {
  it.each(MEASURED)('%s under %s is %s', (slug, competition, stage) => {
    const m = parsed(slug, competition);
    expect(m.stage).toBe(stage);
    expect(m.stageLabel).toBeUndefined();
  });

  it('a group letter attaches only under GROUP: a league season carries none', () => {
    const m = parsed('2026-27-english-premier-league', 'eng.1', {}, {});
    expect(m.group).toBeUndefined();
    const g = parseEspnEvent(event('group-stage'), { competition: 'fifa.world', groupByTeamId: { 'espn:359': 'A', 'espn:363': 'A' } });
    expect(g.kind === 'valid' && g.value.group).toBe('A');
  });
});

describe('a slug the grammar does not know is OTHER, with the provider\'s own words', () => {
  it('an unmeasured cup round carries its words, humanized', () => {
    const m = parsed('qualifying-final', 'uefa.champions');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe('Qualifying final');
  });

  it('a league play-off written on the season name is not the season: the year form matches the written name whole', () => {
    const m = parsed('2026-27-german-bundesliga-relegation-playoffs', 'ger.1');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe('2026 27 german bundesliga relegation playoffs');
  });

  it('another league\'s season name is not this league\'s season', () => {
    const m = parsed('2026-27-laliga', 'eng.1');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe('2026 27 laliga');
  });

  it('the year varies, the name does not', () => {
    expect(parsed('2027-28-english-premier-league', 'eng.1').stage).toBe('REGULAR');
    expect(parsed('2027-english-premier-league', 'eng.1').stage).toBe('REGULAR');
    expect(parsed('2027-28-premier-league', 'eng.1').stage).toBe('OTHER');
  });

  it('a year-prefixed slug under a cup is OTHER (a cup has no season name)', () => {
    const m = parsed('2027-fifa-club-world-cup', 'fifa.cwc');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe('2027 fifa club world cup');
  });

  it('mex.1\'s rounds are mex.1\'s: under a cup the same slug is OTHER', () => {
    const m = parsed('clausura---finals', 'uefa.champions');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe('Clausura finals');
  });

  it('a league\'s season form under a league that has no season name (mex.1) is OTHER', () => {
    expect(parsed('2026-27-liga-mx', 'mex.1').stage).toBe('OTHER');
  });

  it('no substring rule: a slug that CONTAINS a measured one is not it', () => {
    expect(parsed('group-stage-playoffs', 'fifa.world').stage).toBe('OTHER');
    expect(parsed('pre-final', 'uefa.champions').stage).toBe('OTHER');
    expect(parsed('semifinals-leg-2', 'uefa.champions').stage).toBe('OTHER');
  });

  it('`friendly` under a supported competition is OTHER with the provider\'s word, never FRIENDLY', () => {
    for (const c of ['eng.1', 'uefa.champions', 'fifa.world']) {
      const m = parsed('friendly', c);
      expect(m.stage, c).toBe('OTHER');
      expect(m.stageLabel, c).toBe('Friendly');
    }
  });

  it('an unlisted competition is a cup: its slugs are the exact ones or OTHER', () => {
    expect(parsed('2026-27-ligue-1', 'fra.1').stage).toBe('OTHER');
    expect(parsed('regular-season', 'usa.1').stage).toBe('OTHER');
    expect(parsed('final', 'fra.1').stage).toBe('F');
  });
});

describe('an absent, malformed or oversized slug asserts nothing: OTHER with no label', () => {
  it.each([
    ['null', null],
    ['empty', ''],
    ['absent', undefined],
    ['a number', 7],
    ['an object', { slug: 'final' }],
    ['upper case', 'FINAL'],
    ['a space', 'round of 16'],
    ['65 characters', `${'a'.repeat(60)}-final`],
    ['a prototype name', 'constructor'],
  ])('%s', (_label, slug) => {
    const m = parsed(slug, 'uefa.champions');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBeUndefined();
  });

  it('a 64-character slug is still read (the bound is on the raw string, checked before lower-casing)', () => {
    const slug = `${'a'.repeat(58)}-final`;
    expect(slug.length).toBe(64);
    const m = parsed(slug, 'uefa.champions');
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe(`${'a'.repeat(58)} final`);
    const upper = `${'A'.repeat(59)}-final`;
    expect(upper.length).toBe(65);
    expect(parsed(upper, 'uefa.champions').stageLabel).toBeUndefined();
  });

  it('a null-slug cup final keeps its shootout: an unstated phase is not GROUP', () => {
    const m = parsed(
      null,
      'uefa.champions',
      { status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } } },
      {
        competitors: [
          { homeAway: 'home', winner: false, score: '1', shootoutScore: 3, team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' } },
          { homeAway: 'away', winner: true, score: '1', shootoutScore: 4, team: { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' } },
        ],
      },
    );
    expect(m.stage).toBe('OTHER');
    expect(m.shootout).toEqual({ home: 3, away: 4 });
    expect(m.winnerCode).toBe('CHE');
  });

  it('a malformed slug never fails the batch: its record and its siblings are read', () => {
    const list = parseEspnEvents(
      { events: [event({ deep: ['x'] }, { id: '1' }), event('final', { id: '2' }), event('x'.repeat(5000), { id: '3' })] },
      { competition: 'uefa.champions' },
    );
    expect(list.items.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(list.items.map((m) => m.stage)).toEqual(['OTHER', 'F', 'OTHER']);
    expect(list.omitted).toBe(0);
  });

  it('the parser does not throw on a slug it cannot read, whatever its shape', () => {
    for (const slug of [Symbol('x') as unknown, () => 'final', [], new Date(), Object.create(null)]) {
      expect(() => parseEspnEvent(event(slug), { competition: 'uefa.champions' })).not.toThrow();
    }
  });
});

describe('the label travels through the cache as a human label', () => {
  it('a cached OTHER keeps its label; a cached label is bounded at 40 columns; an unreadable one is dropped, the stage stays OTHER', () => {
    const live = parsed('qualifying-final', 'uefa.champions');
    const back = parseCachedMatch(roundTrip(live), { teamKind: 'club' });
    expect(back.kind === 'valid' && back.value).toEqual(live);

    const long = parseCachedMatch({ ...roundTrip(live), stageLabel: 'x'.repeat(80) }, { teamKind: 'club' });
    expect(long.kind === 'valid' && long.value.stageLabel?.length).toBeLessThanOrEqual(40);

    const poisoned = parseCachedMatch({ ...roundTrip(live), stageLabel: '​​' }, { teamKind: 'club' });
    expect(poisoned.kind).toBe('valid');
    expect(poisoned.kind === 'valid' && poisoned.value.stage).toBe('OTHER');
    expect(poisoned.kind === 'valid' && poisoned.value.stageLabel).toBeUndefined();
  });

  it('a label is kept only on OTHER: on any other stage the cache reader drops it', () => {
    const live = parsed('final', 'uefa.champions');
    const back = parseCachedMatch({ ...roundTrip(live), stageLabel: 'Grand final' }, { teamKind: 'club' });
    expect(back.kind === 'valid' && back.value.stageLabel).toBeUndefined();
  });

  it('the cache reader accepts the four new stages and still refuses an unknown one', () => {
    const base = roundTrip(parsed('final', 'uefa.champions')) as Record<string, unknown>;
    for (const stage of ['REGULAR', 'LEAGUE', 'PO', 'OTHER']) {
      const r = parseCachedMatch({ ...base, stage }, { teamKind: 'club' });
      expect(r.kind, stage).toBe('valid');
    }
    expect(parseCachedMatch({ ...base, stage: 'PLAYOFF' }, { teamKind: 'club' }).kind).toBe('malformed');
  });
});

describe('the formatters take the match: OTHER prints its words, an empty OTHER prints nothing', () => {
  const m = (stage: Stage, over: Partial<Match> = {}): Match => ({
    id: '1',
    stage,
    kickoff: '2026-10-04T14:00:00.000Z',
    home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
    away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
    status: 'SCHEDULED',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...over,
  });

  it('English: the new stages and the carried label', () => {
    expect(stageLabel(m('REGULAR'))).toBe('League');
    expect(stageLabel(m('LEAGUE'))).toBe('League phase');
    expect(stageLabel(m('PO'))).toBe('Play-offs');
    expect(stageLabel(m('OTHER', { stageLabel: 'Qualifying final' }))).toBe('Qualifying final');
    expect(stageLabel(m('OTHER'))).toBe('');
    expect(stageLabel(m('GROUP', { group: 'A' }))).toBe('Group A');
  });

  it('four locales for the new stages; the carried label is untranslated', () => {
    const expected: Record<string, [string, string, string]> = {
      en: ['League', 'League phase', 'Play-offs'],
      es: ['Liga', 'Fase de liga', 'Play-offs'],
      pt: ['Liga', 'Fase de liga', 'Play-offs'],
      fr: ['Championnat', 'Phase de ligue', 'Barrages'],
    };
    for (const [lang, [regular, league, po]] of Object.entries(expected)) {
      expect(stageLabelI18n(lang, m('REGULAR')), lang).toBe(regular);
      expect(stageLabelI18n(lang, m('LEAGUE')), lang).toBe(league);
      expect(stageLabelI18n(lang, m('PO')), lang).toBe(po);
      expect(stageLabelI18n(lang, m('OTHER', { stageLabel: 'Qualifying final' })), lang).toBe('Qualifying final');
      expect(stageLabelI18n(lang, m('OTHER')), lang).toBe('');
      expect(stageLabelI18n(lang, m('GROUP', { group: 'B' })), lang).toMatch(/B$/);
    }
    expect(stageLabelI18n('es', m('R16'))).toBe('Octavos de final');
  });
});

describe('one knockout predicate, and the live window it decides', () => {
  it('isKnockoutStage: the rounds and the play-offs; not a season, a league phase, a group, a friendly or an unknown', () => {
    for (const s of ['R32', 'R16', 'QF', 'SF', '3P', 'F', 'PO'] as Stage[]) expect(isKnockoutStage(s), s).toBe(true);
    for (const s of ['GROUP', 'REGULAR', 'LEAGUE', 'OTHER', 'FRIENDLY'] as Stage[]) expect(isKnockoutStage(s), s).toBe(false);
  });

  it('liveWindowMsFor: the short window for every stage that is not a knockout one', () => {
    const at = (stage: Stage): Match => ({
      id: '1',
      stage,
      kickoff: '2026-10-04T14:00:00.000Z',
      home: { code: 'ARS', name: 'Arsenal' },
      away: { code: 'CHE', name: 'Chelsea' },
      status: 'SCHEDULED',
      updatedAt: '2026-10-04T12:00:00.000Z',
    });
    for (const s of ['REGULAR', 'LEAGUE', 'OTHER', 'FRIENDLY', 'GROUP'] as Stage[]) {
      expect(liveWindowMsFor(at(s)), s).toBe(LIVE_WINDOW_MS);
    }
    for (const s of ['PO', 'R16', 'F'] as Stage[]) {
      expect(liveWindowMsFor(at(s)), s).toBeGreaterThan(LIVE_WINDOW_MS);
    }
  });
});
