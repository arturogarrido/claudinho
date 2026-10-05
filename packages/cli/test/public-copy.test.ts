/**
 * The CLI's public copy (0.11 · 2.7): the framing in `--help` and `star` with
 * the count interpolated from the supported table; no em-dash in either, in
 * the sign-off or in the footers; the footer is core's one disclaimer; the
 * sign-off names the 2026 edition and points at the switch in every locale,
 * and so does the statusline's line (English, no URL: the hot path's rule); a
 * Portuguese club table's team column says "Time", the word the other PT
 * strings use; and `vibe`'s themed opener and final lines are the bundled
 * competition's: on the bundle's two dates another selection, or none, gets
 * the everyday pool.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DISCLAIMER, type GroupStandings, type ProviderAdapter, SUPPORTED } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdStar, cmdTable, cmdVibe } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { TOURNAMENT_COMPLETE_LINE } from '../src/statusline';
import { described } from './config-of';

const REST = SUPPORTED.length - 4;
const FRAMING = `the World Cup, the Premier League, LALIGA, the Champions League and ${REST} more`;
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

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
  process.stdout.isTTY = true;
});
afterEach(() => {
  outSpy.mockReset();
  process.stdout.isTTY = tty as boolean;
});
const text = () => writes.join('');

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'fifa.world', flavor: 'off', ...over });
}

describe('--help (the built CLI)', () => {
  it('says the framing with the count the table gives, carries the one disclaimer, and has no em-dash', () => {
    // Commander wraps the description at the help width (80 columns when stdout is not a terminal), so the
    // sentence is looked for on collapsed whitespace, as the Markdown guards look for theirs.
    const help = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).replace(/\s+/g, ' ');
    expect(help).toContain(FRAMING);
    expect(help).toContain(DISCLAIMER);
    expect(help).not.toMatch(/—/);
  });
});

describe('star', () => {
  it('says the framing and has no em-dash', () => {
    cmdStar({ cfg: cfg(), t: makeT('en') } as never);
    expect(text()).toContain(FRAMING);
    expect(text()).not.toMatch(/—/);
  });
});

describe('the sign-off and the statusline line', () => {
  for (const lang of ['en', 'es', 'pt', 'fr'] as const) {
    it(`${lang}: names the 2026 edition, points at the switch, no em-dash`, () => {
      const line = makeT(lang)('signoff.complete');
      expect(line).toContain('2026');
      expect(line).toContain('claudinho follow --list');
      expect(line).not.toMatch(/—/);
    });
  }

  it('the statusline line names 2026 and points at the switch, with no URL', () => {
    expect(TOURNAMENT_COMPLETE_LINE).toContain('2026');
    expect(TOURNAMENT_COMPLETE_LINE).toContain('claudinho follow --list');
    expect(TOURNAMENT_COMPLETE_LINE).not.toMatch(/https?:/);
  });

  it('the localized footer is the one disclaimer in English, and each locale carries every item', () => {
    expect(makeT('en')('disclaimer')).toBe(DISCLAIMER);
    expect(makeT('es')('disclaimer')).toBe('Sin afiliación con la FIFA, con ninguna confederación, liga o club, ni con Anthropic.');
    expect(makeT('pt')('disclaimer')).toBe('Sem afiliação com a FIFA, com nenhuma confederação, liga ou clube, nem com a Anthropic.');
    expect(makeT('fr')('disclaimer')).toBe('Sans affiliation avec la FIFA, ni avec aucune confédération, ligue ou club, ni avec Anthropic.');
  });
});

describe("Portuguese: a team is a 'time'", () => {
  it("the table's team column says Time, the word the other PT strings use", () => {
    expect(makeT('pt')('col.team')).toBe('Time');
    expect(makeT('en')('col.team')).toBe('Team');
  });

  it('a Portuguese club table renders Time in its header row, and no Seleção', async () => {
    const row = (rank: number, id: string, code: string, name: string, won: number, drawn: number, lost: number, goalDiff: number) => ({
      team: { id, code, name },
      played: won + drawn + lost,
      won,
      drawn,
      lost,
      goalsFor: Math.max(goalDiff, 0),
      goalsAgainst: Math.max(-goalDiff, 0),
      goalDiff,
      points: 3 * won + drawn,
      rank,
    });
    const league: GroupStandings = {
      group: 'LEAGUE',
      label: 'English Premier League',
      rows: [row(1, 'espn:359', 'ARS', 'Arsenal', 5, 1, 0, 9), row(2, 'espn:363', 'CHE', 'Chelsea', 4, 1, 1, 5)],
    };
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'eng.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
      async fetchStandings() {
        return [league];
      },
    };
    await cmdTable('LEAGUE', { cfg: cfg({ competition: 'eng.1', lang: 'pt' }), t: makeT('pt'), adapter } as never);
    const out = text();
    const header = out.split('\n').find((line) => line.includes('│')) ?? '';
    expect(header.split('│')[1]?.trim()).toBe('Time');
    expect(out).toContain('Arsenal');
    expect(out).not.toContain('Seleção');
  });
});

describe("vibe's themed lines are the bundled competition's", () => {
  // The bundle's opening day; `Math.random` pinned at the pool's end so the last line is picked.
  const OPENER = new Date('2026-06-11T12:00:00Z');
  let random: ReturnType<typeof vi.spyOn> | undefined;
  beforeEach(() => {
    random = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  });
  afterEach(() => random?.mockRestore());

  it('under the World Cup on its opening day the opener pool is in play', () => {
    cmdVibe({ cfg: cfg({ json: true }), t: makeT('en'), now: OPENER } as never);
    expect(JSON.parse(text()).vibe).toMatch(/Opening day|Day one of the tournament/);
  });

  it('under another competition on that day the everyday pool is in play', () => {
    cmdVibe({ cfg: cfg({ json: true, competition: 'eng.1' }), t: makeT('en'), now: OPENER } as never);
    expect(JSON.parse(text()).vibe).not.toMatch(/Opening day|Day one of the tournament|Final day|trophy/);
  });

  it('with nothing chosen on that day the everyday pool is in play', () => {
    const none = described({ ...cfg({ json: true }), competition: '', selection: { kind: 'none' } as never });
    cmdVibe({ cfg: none, t: makeT('en'), now: OPENER } as never);
    expect(JSON.parse(text()).vibe).not.toMatch(/Opening day|Day one of the tournament|Final day|trophy/);
  });
});
