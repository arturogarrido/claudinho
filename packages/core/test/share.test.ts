import { describe, expect, it } from 'vitest';
import { formatShareSnippet, SHARE_DISCLAIMER, SHARE_HASHTAG } from '../src/index';
import type { Match, MarketSignal } from '../src/index';

const scheduled: Match = {
  id: '760415',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00Z',
  venue: 'Estadio Azteca',
  city: 'Mexico City',
  country: 'Mexico',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
  status: 'SCHEDULED',
  updatedAt: '2026-06-08T00:00:00Z',
};

const other: Match = {
  id: '760416',
  stage: 'GROUP',
  group: 'D',
  kickoff: '2026-06-13T01:00:00Z',
  venue: 'SoFi Stadium',
  city: 'Los Angeles',
  country: 'USA',
  home: { code: 'USA', name: 'United States', flag: '🇺🇸' },
  away: { code: 'PAR', name: 'Paraguay', flag: '🇵🇾' },
  status: 'SCHEDULED',
  updatedAt: '2026-06-08T00:00:00Z',
};

const live: Match = { ...scheduled, status: 'LIVE', minute: 67, score: { home: 1, away: 0 } };

const signal: MarketSignal = {
  matchId: '760415',
  source: 'polymarket',
  asOf: '2026-06-11T14:32:00Z',
  fetchedAt: '2026-06-11T14:35:00Z',
  outcomes: [
    { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.56 },
    { kind: 'draw', label: 'Draw', probability: 0.25 },
    { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.19 },
  ],
  favorite: { kind: 'home', teamCode: 'MEX', probability: 0.56, strength: 'slight' },
  stale: false,
  ambiguous: false,
};

const base = {
  title: 'Next up for Mexico',
  matches: [scheduled],
  installLine: 'npx @claudinho/cli next MEX',
  tz: 'UTC',
  locale: 'en',
};

/** Terms the market copy must never contain (legal control). */
const BANNED = /\b(bet|betting|wager|gambling|edge|lock|value pick)\b/i;
const ESC = String.fromCharCode(27); // ANSI escape introducer

describe('formatShareSnippet — social card', () => {
  const out = formatShareSnippet(
    { ...base, marketSignals: new Map([[scheduled.id, signal]]) },
    { style: 'social' },
  );

  it('renders the title, teams, kickoff, and venue', () => {
    expect(out).toContain('Next up for Mexico');
    expect(out).toContain('🇲🇽 Mexico vs South Africa 🇿🇦');
    expect(out).toContain('Jun 11 · 19:00 UTC');
    expect(out).toContain('Estadio Azteca, Mexico City, Mexico');
  });

  it('renders the market block from the approved copy bank', () => {
    expect(out).toContain('Prediction markets slightly favor Mexico.');
    expect(out).toContain('Mexico 56% · Draw 25% · South Africa 19%');
    expect(out).toContain('Polymarket');
    expect(out).toContain('informational only');
  });

  it('always carries the hashtag, disclaimer, and install cue', () => {
    expect(out).toContain(SHARE_HASHTAG);
    expect(out).toContain(SHARE_DISCLAIMER);
    expect(out).toContain('Try it: npx @claudinho/cli next MEX');
  });

  it('is plain text (no ANSI) and uses no betting/advice language', () => {
    expect(out).not.toContain(ESC); // must paste cleanly everywhere
    expect(out).not.toMatch(BANNED);
  });
});

describe('formatShareSnippet — toggles', () => {
  it('omits the hashtag but KEEPS the disclaimer when includeHashtag is false', () => {
    const out = formatShareSnippet(base, { includeHashtag: false });
    expect(out).not.toContain(SHARE_HASHTAG);
    expect(out).toContain(SHARE_DISCLAIMER); // non-optional, always present
  });

  it('omits the install cue when includeInstallLine is false', () => {
    const out = formatShareSnippet(base, { includeInstallLine: false });
    expect(out).not.toContain('Try it:');
    expect(out).toContain(SHARE_DISCLAIMER);
  });

  it('omits the market block when includeMarkets is false', () => {
    const out = formatShareSnippet(
      { ...base, marketSignals: new Map([[scheduled.id, signal]]) },
      { includeMarkets: false },
    );
    expect(out).not.toContain('Prediction markets');
  });
});

describe('formatShareSnippet — compact style', () => {
  const out = formatShareSnippet(
    {
      title: "Today's matches · Jun 13",
      matches: [scheduled, other],
      source: 'espn',
      marketSignals: new Map([[scheduled.id, signal]]),
      tz: 'UTC',
      locale: 'en',
    },
    { style: 'compact' },
  );

  it('uses 3-letter codes, one line per match, no venue', () => {
    expect(out).toContain('🇲🇽 MEX vs RSA 🇿🇦 · 19:00');
    expect(out).toContain('🇺🇸 USA vs PAR 🇵🇾 · 01:00');
    expect(out).not.toContain('Estadio Azteca');
  });

  it('never shows market lines in compact (the minimal style)', () => {
    expect(out).not.toContain('Prediction markets');
    expect(out).not.toContain('Market:');
  });

  it('attributes the live source when present', () => {
    expect(out).toContain('Live data: ESPN');
  });

  it('includes the date for a lone scheduled match so a `next` snippet is self-contained', () => {
    const lone = formatShareSnippet(
      { title: 'Next up for Mexico', matches: [scheduled], tz: 'UTC', locale: 'en' },
      { style: 'compact' },
    );
    expect(lone).toContain('🇲🇽 MEX vs RSA 🇿🇦 · Jun 11 19:00');
  });
});

describe('formatShareSnippet — social list uses one-line market annotations', () => {
  it('uses marketLine (not the 3-line block) when there are multiple matches', () => {
    const out = formatShareSnippet(
      {
        title: "Today's matches",
        matches: [scheduled, other],
        marketSignals: new Map([[scheduled.id, signal]]),
        tz: 'UTC',
        locale: 'en',
      },
      { style: 'social' },
    );
    expect(out).toContain('Market: Mexico 56% · Draw 25% · South Africa 19%');
    // The narrative favorite sentence is reserved for single-match cards.
    expect(out).not.toContain('Prediction markets slightly favor Mexico.');
  });
});

describe('formatShareSnippet — live + empty', () => {
  it('shows the score and minute for a live match', () => {
    const out = formatShareSnippet(
      { title: 'Live match pulse', matches: [live], source: 'espn', tz: 'UTC', locale: 'en' },
      { style: 'social' },
    );
    expect(out).toContain('🇲🇽 Mexico 1–0 South Africa 🇿🇦');
    expect(out).toContain("· 67'");
    expect(out).toContain('Live data: ESPN');
  });

  it('still produces a valid titled card with the disclaimer when there are no matches', () => {
    const out = formatShareSnippet(
      { title: 'Live match pulse', matches: [], installLine: 'npx @claudinho/cli live' },
      { style: 'social' },
    );
    expect(out).toContain('Live match pulse');
    expect(out).toContain(SHARE_DISCLAIMER);
  });

  it('renders the emptyNote as the body when there are no matches (no void card)', () => {
    const out = formatShareSnippet(
      {
        title: 'Next up for ZZZ',
        matches: [],
        emptyNote: 'No upcoming fixture found for ZZZ.',
        installLine: 'npx @claudinho/cli next ZZZ',
      },
      { style: 'social' },
    );
    expect(out).toContain('No upcoming fixture found for ZZZ.');
    expect(out).toContain(SHARE_DISCLAIMER);
  });
});
