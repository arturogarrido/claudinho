/**
 * Round 15. Every case here is a defect that shipped GREEN through the suites
 * already in this PR, so each one names what it would have caught.
 *
 * The first is the sharpest: a rule I added in round 14 to refuse impossible
 * states ("penalties mid-match") refused a state that happens in every knockout
 * shootout ever taken. A tightening is a change like any other and needs a case
 * proving the legitimate side still works — otherwise "fail closed" quietly
 * becomes "fail on the interesting data".
 */
import { describe, expect, it } from 'vitest';
import { parseCachedMatch, parseEspnEvent, parseEspnEvents } from '../src/trust';
import { humanLabel } from '../src/trust/roles';

const KO = {
  id: '760415',
  stage: 'QF' as const,
  kickoff: '2026-07-04T19:00:00.000Z',
  home: { code: 'GER', name: 'Germany' },
  away: { code: 'PAR', name: 'Paraguay' },
  updatedAt: '2026-07-04T21:30:00.000Z',
};
const seal = (o: object) => parseCachedMatch({ ...KO, ...o });
const sealed = (o: object) => {
  const r = seal(o);
  if (r.kind !== 'valid') throw new Error(`expected valid, got ${r.kind}`);
  return r.value;
};

describe('a shootout is kept while it is being TAKEN', () => {
  it('keeps penalties on a LIVE knockout tie — the moment the surface exists for', () => {
    // The regression: gating the shootout on FT meant a tie level at 1-1 with
    // penalties 3-2 rendered as a bare "1–1" for the several minutes that
    // actually decide it. Reported against the base implementation, which had
    // no such gate.
    const m = sealed({ status: 'LIVE', score: { home: 1, away: 1 }, shootout: { home: 3, away: 2 } });
    expect(m.shootout).toEqual({ home: 3, away: 2 });
  });

  it('keeps a level shootout in progress — 3-3 is sudden death, not a contradiction', () => {
    const m = sealed({ status: 'LIVE', score: { home: 1, away: 1 }, shootout: { home: 3, away: 3 } });
    expect(m.shootout).toEqual({ home: 3, away: 3 });
  });

  it('refuses a FINISHED shootout that is level — that one really cannot exist', () => {
    expect(
      seal({ status: 'FT', score: { home: 1, away: 1 }, shootout: { home: 3, away: 3 } }).kind,
    ).toBe('malformed');
  });

  it('and does not then advance anyone on the strength of the field it refused', () => {
    // The subtle half: dropping the contradictory shootout leaves a level FT
    // knockout, which the winner rule treats as "settled some other way" and
    // honours. Tested against what was CLAIMED, so it does not fall through.
    expect(
      seal({
        status: 'FT',
        score: { home: 1, away: 1 },
        shootout: { home: 3, away: 3 },
        winnerCode: 'GER',
      }).kind,
    ).toBe('malformed');
  });

  it('keeps a shootout in a NON-World-Cup cup tie (the CLAUDINHO_COMPETITION seam)', () => {
    // `FRIENDLY` is the catch-all stage for anything outside the bundled
    // schedule — every competition reachable through CLAUDINHO_COMPETITION.
    // Excluding it from "can go to penalties" dropped real shootouts: two
    // J-League cup ties in a 175-fixture ESPN corpus lost `shootout: 5-3` and
    // their winner. Caught by diffing real-feed output against main; no test
    // covered it, because every fixture in the suite was a World Cup one.
    const m = sealed({
      stage: 'FRIENDLY',
      status: 'FT',
      score: { home: 2, away: 2 },
      shootout: { home: 5, away: 3 },
      winnerCode: 'GER',
    });
    expect(m.shootout).toEqual({ home: 5, away: 3 });
    expect(m.winnerCode).toBe('GER');
  });

  it('still refuses penalties where they cannot happen', () => {
    expect(
      seal({ status: 'FT', score: { home: 2, away: 0 }, shootout: { home: 4, away: 3 } }).kind,
    ).toBe('malformed'); // not level
    expect(
      seal({
        stage: 'GROUP',
        status: 'FT',
        score: { home: 1, away: 1 },
        shootout: { home: 4, away: 3 },
      }).kind,
    ).toBe('malformed'); // a World Cup group draw is a final result
  });
});

describe('a team cannot play itself, on EITHER path', () => {
  it('refuses it from the cache file, not just from the feed', () => {
    // The rule lived in the ESPN parser only, so `MEX vs MEX` sealed clean out
    // of a cache file — the exact live-path/cache-path asymmetry this refactor
    // exists to remove, reintroduced by putting a rule at one entry point.
    const r = parseCachedMatch({
      ...KO,
      status: 'SCHEDULED',
      home: { code: 'MEX', name: 'Mexico' },
      away: { code: 'MEX', name: 'Mexico' },
    });
    expect(r.kind).toBe('definitive-none');
  });

  it('and still allows two DIFFERENT unresolved bracket slots', () => {
    // They share an abbreviation and differ only by name, so a code-only test
    // would collapse them into one team.
    const r = parseCachedMatch({
      ...KO,
      status: 'SCHEDULED',
      home: { code: 'RD32', name: 'Round of 32 1 Winner' },
      away: { code: 'RD32', name: 'Round of 32 3 Winner' },
    });
    expect(r.kind).toBe('valid');
  });
});

describe('an unrecognized status drops the fixture rather than inventing one', () => {
  it('does not turn a scored event into a scoreless SCHEDULED one', () => {
    // `?? 'SCHEDULED'` contradicted the rule sealMatch states for this field and
    // did the exact damage the rule prevents: a match being played rendered as
    // one yet to come, with its score erased.
    const r = parseEspnEvent({
      id: '760415',
      date: '2026-06-29T19:00Z',
      season: { slug: 'group-stage' },
      status: { type: { name: 'STATUS_WHO_KNOWS', state: 'quantum' } },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', score: '2', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
            { homeAway: 'away', score: '0', team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' } },
          ],
        },
      ],
    });
    expect(r.kind).toBe('malformed');
  });

  it('maps every status shape the real feed serves (368 events, 5 distinct)', () => {
    const shapes: [unknown, string][] = [
      [{ type: { name: 'STATUS_FULL_TIME', state: 'post' } }, 'FT'],
      [{ type: { name: 'STATUS_FINAL_PEN', state: 'post' } }, 'FT'],
      [{ type: { name: 'STATUS_SECOND_HALF', state: 'in' } }, 'LIVE'],
      [{ type: { name: 'STATUS_FIRST_HALF', state: 'in' } }, 'LIVE'],
      [{ type: { name: 'STATUS_SCHEDULED', state: 'pre' } }, 'SCHEDULED'],
      [{ type: { name: 'STATUS_CANCELED', state: 'post' } }, 'CANCELLED'],
    ];
    for (const [status, expected] of shapes) {
      const scored = expected === 'FT' || expected === 'LIVE';
      const r = parseEspnEvent({
        id: '760415',
        date: '2026-06-29T19:00Z',
        season: { slug: 'group-stage' },
        status,
        competitions: [
          {
            competitors: [
              {
                homeAway: 'home',
                ...(scored ? { score: '1' } : {}),
                team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
              },
              {
                homeAway: 'away',
                ...(scored ? { score: '0' } : {}),
                team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' },
              },
            ],
          },
        ],
      });
      expect(r.kind, `${JSON.stringify(status)} should seal`).toBe('valid');
      if (r.kind === 'valid') expect(r.value.status).toBe(expected);
    }
  });

  it('drops only the unreadable event, never the batch', () => {
    const ok = {
      id: '760416',
      date: '2026-06-29T19:00Z',
      season: { slug: 'group-stage' },
      status: { type: { name: 'STATUS_FULL_TIME', state: 'post' } },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', score: '1', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
            { homeAway: 'away', score: '0', team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' } },
          ],
        },
      ],
    };
    const list = parseEspnEvents({ events: [{ ...ok, id: '760415', status: { type: { state: 'x' } } }, ok] });
    expect(list.items).toHaveLength(1);
    expect(list.complete).toBe(false); // and says so
  });
});

describe('a label has to be visible to be a label', () => {
  it('refuses a name made only of combining marks', () => {
    // Not a control, not a format character, not emoji — so every other rule
    // passed it, and it renders as zero columns. A nation named nothing at all.
    expect(humanLabel('́́́')).toBe('');
    expect(seal({ home: { code: 'GER', name: '́́' } }).kind).toBe('malformed');
  });

  it('and leaves every real name alone', () => {
    for (const n of ['México', 'Côte d’Ivoire', 'Türkiye', 'Korea Republic', 'Curaçao']) {
      expect(humanLabel(n)).toBe(n);
    }
  });
});
