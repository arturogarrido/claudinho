import { describe, expect, it } from 'vitest';
import { displayWidth, type StandingRow } from '@claudinho/core';
import { standingsTable } from '../src/format';

const ENGLAND = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
const SCOTLAND = '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';

function row(code: string, name: string, flag: string): StandingRow {
  return {
    team: { code, name, flag },
    played: 1,
    won: 1,
    drawn: 0,
    lost: 0,
    goalsFor: 2,
    goalsAgainst: 0,
    goalDiff: 2,
    points: 3,
  };
}

describe('standingsTable — display-width alignment (I18N-3)', () => {
  const table = standingsTable('L', [
    row('MEX', 'Mexico', '🇲🇽'),
    row('ENG', 'England', ENGLAND),
    row('SCO', 'Scotland', SCOTLAND),
  ]);
  const lines = table.split('\n');
  const dataLines = lines.slice(2); // header + column line first

  it('tag-sequence flag rows align with regional-flag rows (same display width)', () => {
    const widths = dataLines.map((l) => displayWidth(l));
    expect(new Set(widths).size).toBe(1);
  });

  it('never truncates a nation mid-name', () => {
    expect(table).toContain('England');
    expect(table).toContain('Scotland');
  });

  it('data rows align with the column header (P over the played column)', () => {
    const header = lines[1]!;
    // Header is ASCII, so index == display column there. Each row's first digit
    // (played=1; names carry no digits) must land in the same display column.
    const headerP = header.indexOf('P', header.indexOf('Team') + 4) + 1;
    for (const l of dataLines) {
      const digitAt = l.search(/\d/);
      expect(displayWidth(l.slice(0, digitAt + 1))).toBe(headerP);
    }
  });
});
