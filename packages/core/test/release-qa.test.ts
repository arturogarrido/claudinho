/**
 * `scripts/release-qa.sh` renders every surface against the live feed, so no
 * test runs it. What it DECIDES about the competition is in
 * `scripts/release-qa-lib.mjs` (0.11 · 2.5a), and is run here offline:
 *   - the default mode FOLLOWS the World Cup in a config directory the script
 *     creates for the run (2.5b: nothing chosen is no competition), so the
 *     mode line reads `World Cup` with no source, as a user's would; the
 *     caller's CLAUDINHO_COMPETITION still wins over it, as it does for a
 *     user; the header names what the built CLI RESOLVED, read back from its
 *     JSON (`saved (World Cup)`, or `none chosen` when the follow failed);
 *   - the drift tripwire is gated on the competition the built CLI RESOLVED
 *     (an alias is its slug), never on the raw environment value;
 *   - a competition the script cannot resolve, and a drift verdict it cannot
 *     read (an empty one included), FAIL: a broken check never reads as a
 *     quiet feed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { competitionLabel, driftGate, driftVerdict, resolvedSlug } from '../../../scripts/release-qa-lib.mjs';
// The club render's decisions (0.11 · 2.7), through the namespace so each case fails on its own while they are owed.
import * as qaLib from '../../../scripts/release-qa-lib.mjs';
import {
  BUNDLE_COMPETITION,
  DISCLAIMER,
  nextHorizonSentence,
  nextNoneReadSentence,
  verdictNotice,
  verdictQualifiers,
} from '../src';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SCRIPT = path('../../../scripts/release-qa.sh');
const CLI_DIST = path('../../cli/dist/index.js');

describe('the decisions, offline', () => {
  it('the header names the competition the CLI resolved, read back from its JSON, never assumed', () => {
    const answer = (chosenBy: string, name: string) => JSON.stringify({ tables: null, competition: { slug: 'x', name, chosenBy } });
    expect(competitionLabel(answer('saved', 'World Cup'))).toBe('saved (World Cup)');
    expect(competitionLabel(answer('env', 'Premier League'))).toBe('env (Premier League)');
    expect(competitionLabel(answer('env', 'fifa.friendly'))).toBe('env (fifa.friendly)');
    // A failed follow and nothing else chosen: never "saved (World Cup)".
    expect(competitionLabel(JSON.stringify({ competition: null, noCompetition: true }))).toBe('none chosen');
    expect(competitionLabel('')).toBe('unresolved');
    expect(competitionLabel('not json')).toBe('unresolved');
  });

  it('the resolved slug is read from the CLI\'s --json, and nothing else', () => {
    expect(resolvedSlug(JSON.stringify({ tables: null, competition: { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'env' } }))).toBe('fifa.world');
    expect(resolvedSlug('')).toBeUndefined(); // a refused value prints nothing on stdout
    expect(resolvedSlug('not json')).toBeUndefined();
    expect(resolvedSlug(JSON.stringify({ tables: null }))).toBeUndefined();
    expect(resolvedSlug(JSON.stringify({ competition: { slug: 7 } }))).toBeUndefined();
  });

  it('the drift tripwire runs for the bundled competition, skips another, and FAILS when nothing was resolved', () => {
    expect(driftGate(BUNDLE_COMPETITION, BUNDLE_COMPETITION)).toEqual({ kind: 'run' });
    expect(driftGate('fifa.friendly', BUNDLE_COMPETITION)).toMatchObject({ kind: 'skip' });
    expect(driftGate('eng.1', BUNDLE_COMPETITION).kind).toBe('skip');
    expect(driftGate(undefined, BUNDLE_COMPETITION).kind).toBe('fail');
  });

  it('a drift verdict that cannot be read is broken, an empty one included', () => {
    expect(driftVerdict('DRIFT-OK 12')).toEqual({ kind: 'ok', detail: '12' });
    expect(driftVerdict('DRIFT-FAIL missing:1,shifted:2')).toEqual({ kind: 'fail', detail: 'missing:1,shifted:2' });
    expect(driftVerdict('DRIFT-SKIP').kind).toBe('skip');
    expect(driftVerdict('').kind).toBe('broken');
    expect(driftVerdict('   ').kind).toBe('broken');
    expect(driftVerdict('TypeError: x is not a function').kind).toBe('broken');
    expect(driftVerdict(undefined).kind).toBe('broken');
  });
});

describe('the script asks those decisions, and sets no competition of its own', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const code = script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('exports no default competition, and reads no raw CLAUDINHO_COMPETITION', () => {
    expect(code).not.toMatch(/export\s+CLAUDINHO_COMPETITION/);
    expect(code).not.toMatch(/\$\{?CLAUDINHO_COMPETITION/);
  });

  it('follows the World Cup in a config directory of its own, created for the run and removed after it', () => {
    expect(code).toMatch(/QA_CONFIG="\$\(mktemp -d/);
    expect(code).toMatch(/export XDG_CONFIG_HOME="\$QA_CONFIG"/);
    expect(code).toMatch(/trap '[^']*rm -rf "\$QA_CONFIG"[^']*' EXIT/);
    expect(code).toMatch(/cli follow world-cup/);
    // Followed BEFORE the first surface is rendered.
    expect(code.indexOf('cli follow world-cup')).toBeLessThan(code.indexOf('run bracket'));
  });

  it('the header, the gate and the verdict go through the helper; the fallbacks FAIL', () => {
    expect(code).toContain('competition=$(cli table Z --json 2>/dev/null | qa label)');
    expect(code).toMatch(/RESOLVED="\$\(cli table Z --json 2>\/dev\/null \| qa slug\)"/);
    expect(code).toContain('GATE="$(qa gate "$RESOLVED")"');
    expect(code).toContain('VERDICT="$(printf \'%s\' "$DRIFT" | qa verdict)"');
    // Both `*)` fallbacks of the drift tripwire are failed checks, never a skip.
    const t8 = code.slice(code.indexOf('RESOLVED='));
    const fallbacks = [...t8.matchAll(/^\s*\*\)\s*\n\s*(\S+ \S+)/gm)].map((m) => m[1]);
    expect(fallbacks).toEqual(['check no', 'check no']);
  });

  it("the tripwires' renders are English, the language their guards read (the flag wins over CLAUDINHO_LANG and LANG)", () => {
    const lines = code.split('\n').map((l) => l.trim());
    for (const [name, line] of [
      ['BR_EN', 'BR_EN="$(cli bracket --lang en 2>/dev/null)"'],
      ['BR_UTC', 'BR_UTC="$(cli bracket --lang en --tz UTC 2>/dev/null)"'],
      ['BR_TYO', 'BR_TYO="$(cli bracket --lang en --tz Asia/Tokyo 2>/dev/null)"'],
      ['TD_EN', 'TD_EN="$(cli today --lang en 2>/dev/null)"'],
    ]) {
      const assigned = lines.filter((l) => l.startsWith(`${name}=`));
      expect(assigned, name).toEqual([line]);
    }
  });

  it('asks nothing of the removed share command, and the shootout tripwire renders through a formatter that ships', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/share/i);
    // The disclaimer tripwires read two renders the script already makes in English.
    expect(code).toMatch(/not affiliated with FIFA" <<<"\$BR_EN"/);
    expect(code).toMatch(/not affiliated with FIFA" <<<"\$TD_EN"/);
    // The penalty render: core's bracket list, which calls the one scoreline, on a synthetic shootout tie.
    const pens = code.slice(code.indexOf('PENS="$('), code.indexOf('1(3)–1(4)" <<<"$PENS"'));
    expect(pens).toContain('formatBracketList');
    expect(pens).toContain('shootout');
  });

  it.skipIf(process.platform === 'win32')('parses', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow();
  });
});

describe.skipIf(!existsSync(CLI_DIST))('the built CLI answers the question the script asks', () => {
  // A cache directory of its own: the CLI never reads the developer's. And a
  // config directory as the script makes one: the World Cup followed in it.
  const cache = mkdtempSync(join(tmpdir(), 'claudinho-release-qa-'));
  const followed = join(cache, 'config');
  mkdirSync(join(followed, 'claudinho'), { recursive: true });
  writeFileSync(join(followed, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition: 'fifa.world' }));
  const empty = join(cache, 'empty-config');
  afterAll(() => rmSync(cache, { recursive: true, force: true }));
  const ask = (env: string | undefined, config = followed) => {
    const base: NodeJS.ProcessEnv = { ...process.env, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: config };
    delete base.CLAUDINHO_COMPETITION;
    if (env !== undefined) base.CLAUDINHO_COMPETITION = env;
    try {
      return execFileSync(process.execPath, [CLI_DIST, 'table', 'Z', '--json'], { env: base, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      // An input error exits 1; what it wrote on stdout is still its answer (nothing, or the no-competition object).
      return String((e as { stdout?: unknown }).stdout ?? '');
    }
  };

  it('the followed World Cup, the alias and the slug are the World Cup; an unknown value, and nothing chosen, resolve nothing', { timeout: 60_000 }, () => {
    for (const env of [undefined, 'world-cup', 'fifa.world']) {
      expect(resolvedSlug(ask(env)), String(env)).toBe(BUNDLE_COMPETITION);
    }
    expect(resolvedSlug(ask('foo'))).toBeUndefined();
    // Nothing chosen (no file, no environment): `{ competition: null, noCompetition: true }`, no slug: the gate FAILS.
    expect(JSON.parse(ask(undefined, empty))).toEqual({ competition: null, noCompetition: true });
    expect(resolvedSlug(ask(undefined, empty))).toBeUndefined();
  });
});

describe('the command-line form the script calls (not only the functions)', () => {
  const LIB = path('../../../scripts/release-qa-lib.mjs');
  const run = (args: string[], input = '') =>
    execFileSync(process.execPath, [LIB, ...args], { input, encoding: 'utf8', env: { ...process.env, CLAUDINHO_COMPETITION: '' } });

  it('`gate ""` (nothing resolved) FAILS, never a quiet skip; `gate <bundle>` runs; `gate <other>` skips', () => {
    expect(existsSync(path('../dist/index.js')), 'core dist (pnpm -r build)').toBe(true);
    expect(run(['gate', ''])).toMatch(/^fail:/);
    expect(run(['gate', BUNDLE_COMPETITION])).toBe('run');
    expect(run(['gate', 'eng.1'])).toMatch(/^skip/);
  });

  it('`slug` prints the resolved slug from the CLI\'s JSON, and nothing on an empty or unreadable input', () => {
    expect(run(['slug'], JSON.stringify({ tables: null, competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'env' } }))).toBe('eng.1');
    expect(run(['slug'], '')).toBe('');
    expect(run(['slug'], 'not json')).toBe('');
  });

  it('`next` asks the built core\'s sentence builders (a horizon answer whose text says its horizon is a render)', () => {
    const sentence = nextHorizonSentence({ horizon: { days: 14 }, query: 'Arsenal' } as never, 'Arsenal', 'en') ?? '';
    const text = `Next up for Arsenal\n  Premier League\n\n  ${sentence}\n\n${DISCLAIMER}`;
    const json = JSON.stringify({ team: 'Arsenal', fixture: null, degraded: false, source: null, horizon: { days: 14 }, competition: { slug: 'eng.1', name: 'Premier League', chosenBy: 'saved' } });
    expect(sentence).not.toBe('');
    expect(run(['next', text], json)).toBe('ok:no fixture in the span, its sentence shown');
    // The same answer whose text does not say its horizon: the built core's sentence is what is asked for.
    expect(run(['next', text.replace(sentence, 'Nothing.')], json)).toBe('fail:the horizon is not said in its text');
    expect(run(['next', text], '')).toBe('broken:the next command answered no JSON');
    expect(run(['next-disclaimer'], text)).toBe('ok');
    expect(run(['next-disclaimer'], text.replace(DISCLAIMER, ''))).toBe('fail:the club answer does not carry the disclaimer');
  });

  it('`label` names what the CLI resolved, read from its JSON on standard input', () => {
    expect(run(['label'], JSON.stringify({ tables: null, competition: { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'saved' } }))).toBe('saved (World Cup)');
    expect(run(['label'], JSON.stringify({ competition: null, noCompetition: true }))).toBe('none chosen');
    expect(run(['label'], '')).toBe('unresolved');
  });
});

/**
 * The club render (0.11 · 2.7): after the bundle pass, the script renders a
 * club competition's surfaces (the Premier League, followed in a SECOND config
 * directory of its own) and a seeded `prompt`, unless the header it already
 * prints says the environment chose the competition (then the run is one pass
 * of that competition). A between-editions league is a valid render, an outage
 * is reported as one, and the bracket is not asked.
 */
describe('the club render: its decisions, offline', () => {
  const header = (chosenBy: string, name = 'World Cup', slug = 'fifa.world') =>
    JSON.stringify({ tables: null, competition: { slug, name, chosenBy } });

  it('runs after a saved bundle pass, and is skipped when the environment chose the competition or nothing was resolved', () => {
    expect(qaLib.clubPass(header('saved'))).toEqual({ kind: 'run' });
    const env = qaLib.clubPass(header('env', 'LALIGA', 'esp.1'));
    expect(env.kind).toBe('skip');
    expect(env.kind === 'skip' && env.detail).toMatch(/environment/);
    expect(env.kind === 'skip' && env.detail).toContain('LALIGA');
    for (const nothing of [JSON.stringify({ competition: null, noCompetition: true }), '', 'not json']) {
      expect(qaLib.clubPass(nothing).kind, nothing).toBe('skip');
    }
  });

  it('the club header names what the club config resolved, and the club config must follow the Premier League', () => {
    const followed = JSON.stringify({ competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' }, saved: { version: 1, competition: 'eng.1' } });
    expect(qaLib.clubHeader(followed)).toBe('club render · competition=saved (Premier League)');
    expect(qaLib.clubHeader('')).toBe('club render · competition=unresolved');
    expect(qaLib.clubFollowed(followed)).toEqual({ kind: 'ok' });
    expect(qaLib.clubFollowed(JSON.stringify({ competition: { slug: 'fifa.world', name: 'World Cup', chosenBy: 'saved' } })).kind).toBe('fail');
    expect(qaLib.clubFollowed('').kind).toBe('fail');
    expect(qaLib.CLUB).toEqual({ alias: 'premier-league', slug: 'eng.1', team: 'Arsenal' });
  });

  it('the club answer\'s text carries the one disclaimer, whatever it answered', () => {
    expect(qaLib.textCarriesDisclaimer(`x\n${DISCLAIMER}`, DISCLAIMER)).toBe(true);
    expect(qaLib.textCarriesDisclaimer('x\nIndependent fan project · not affiliated with FIFA or Anthropic.', DISCLAIMER)).toBe(false);
    expect(qaLib.textCarriesDisclaimer('', DISCLAIMER)).toBe(false);
    expect(qaLib.textCarriesDisclaimer(`x\n${DISCLAIMER}`, '')).toBe(false);
  });

  it('the Portuguese table: the header row\'s first cell is Time; any other header fails, naming it; no box row skips; nothing is broken', () => {
    const table = (head: string) => `  Premier League\n\nPremier League (LEAGUE)\n┌──────┬───┐\n│ ${head} │ J │\n├──────┼───┤\n│ ARS  │ 7 │\n└──────┴───┘`;
    expect(qaLib.ptTableVerdict(table('Time')).kind).toBe('ok');
    const english = qaLib.ptTableVerdict(table('Team'));
    expect(english.kind).toBe('fail');
    expect(english.detail).toContain('Team');
    const nation = qaLib.ptTableVerdict(table('Seleção'));
    expect(nation.kind).toBe('fail');
    expect(nation.detail).toContain('Seleção');
    expect(qaLib.ptTableVerdict('  Premier League\n  Classificação ao vivo indisponível.').kind).toBe('skip');
    expect(qaLib.ptTableVerdict('').kind).toBe('broken');
  });

  it('the seeded prompt renders the seeded club match and starts no refresher', () => {
    const seeded = 'ARS 2–1 CHE';
    expect(qaLib.promptVerdict("⚽ ARS 2–1 CHE 50'", '0', seeded).kind).toBe('ok');
    expect(qaLib.promptVerdict("⚽ ARS 2–1 CHE 50'", '1', seeded).kind).toBe('fail');
    expect(qaLib.promptVerdict('⚽ —', '0', seeded).kind).toBe('fail');
    expect(qaLib.promptVerdict("⚽ ARS 2–1 CHE 50'", '', seeded).kind).toBe('broken');
    expect(qaLib.promptVerdict("⚽ ARS 2–1 CHE 50'", 'x', seeded).kind).toBe('broken');
  });
});

/**
 * The club answer: `clubNextVerdict` asks `next Arsenal --json` what it
 * answered and asks the TEXT of `next Arsenal` whether it says so, with core's
 * own sentence builders handed in. One case per row of its table, in its order.
 */
describe('the club answer: what next answered, and whether its text says so', () => {
  const CORE = { verdictNotice, verdictQualifiers, nextHorizonSentence, nextNoneReadSentence };
  const ARS = { id: 'espn:359', code: 'ARS', name: 'Arsenal' };
  const CHE = { id: 'espn:363', code: 'CHE', name: 'Chelsea' };
  const FIXTURE = { id: '800000011', stage: 'REGULAR', kickoff: '2026-10-10T14:00:00.000Z', venue: 'Emirates Stadium', home: ARS, away: CHE, status: 'SCHEDULED', updatedAt: '2026-10-04T12:00:00.000Z' };
  const PL = { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' };
  const text = (...body: string[]) => ['', 'Next up for Arsenal', '  Premier League', '', ...body.map((l) => `  ${l}`), '', DISCLAIMER].join('\n');
  const answer = (over: Record<string, unknown>) =>
    JSON.stringify({ team: ARS, fixture: null, degraded: false, source: null, competition: PL, ...over });
  // The sentence an answer of this shape prints, from core's builders (never spelled here).
  const said = (over: Record<string, unknown>) => {
    const result = { team: ARS, query: 'Arsenal', ...over } as never;
    return {
      notice: verdictNotice(result, 'en') ?? '',
      qualifiers: verdictQualifiers(result, 'en'),
      horizon: nextHorizonSentence(result, 'Arsenal', 'en') ?? '',
      noneRead: nextNoneReadSentence(result, 'Arsenal', 'en') ?? '',
    };
  };
  const verdict = (json: string, shown: string) => qaLib.clubNextVerdict(json, shown, CORE);

  it('no JSON: broken; no text: broken', () => {
    for (const json of ['', 'not json', '[]', 'null']) {
      expect(verdict(json, text('x')), json).toEqual({ kind: 'broken', detail: 'the next command answered no JSON' });
    }
    expect(verdict(answer({ horizon: { days: 14 } }), '')).toEqual({ kind: 'broken', detail: 'the next command printed nothing' });
  });

  it("an answer that is not this club render's is broken, and says what is wrong", () => {
    const shown = text(said({ horizon: { days: 14 } }).horizon);
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ competition: { ...PL, slug: 'fifa.world' } }, /fifa\.world/],
      [{ competition: undefined }, /competition/],
      [{ fixture: undefined }, /fixture/],
      [{ fixture: 'none' }, /fixture/],
      [{ fixture: [] }, /fixture/],
      [{ team: undefined }, /team/],
      [{ team: '' }, /team/],
      [{ team: { code: 'ARS' } }, /team/],
    ];
    for (const [over, why] of cases) {
      const v = verdict(answer({ horizon: { days: 14 }, ...over }), shown);
      expect(v.kind, JSON.stringify(over)).toBe('broken');
      expect(v.detail, JSON.stringify(over)).toMatch(why);
    }
  });

  it('a betweenEditions that states no date is broken', () => {
    for (const between of [{}, { ended: 'soon' }, { ended: 20270523 }, 'yes', true]) {
      expect(verdict(answer({ betweenEditions: between }), text('x')), JSON.stringify(between)).toEqual({ kind: 'broken', detail: 'betweenEditions states no date' });
    }
  });

  it('candidates: Arsenal resolved to several clubs, a failed render', () => {
    const v = verdict(answer({ team: 'Arsenal', candidates: [ARS, { id: 'espn:9', code: 'ARW', name: 'Arsenal Women' }] }), text('"Arsenal" is ambiguous.'));
    expect(v).toEqual({ kind: 'fail', detail: '"Arsenal" resolved to 2 clubs; the club render asks one name that must resolve' });
  });

  it('a replacing verdict about the club, or the competition, is a failed render', () => {
    for (const key of ['unknownTeam', 'rosterIncomplete', 'noCompetition', 'unsupported', 'inapplicable']) {
      const v = verdict(answer({ team: 'Arsenal', [key]: true }), text(said({ [key]: true }).notice));
      expect(v, key).toEqual({ kind: 'fail', detail: `next answered ${key} for Arsenal` });
    }
  });

  it('between editions is a VALID render when the text says so, and a failed one when it does not', () => {
    const between = { betweenEditions: { ended: '2027-05-23' } };
    expect(verdict(answer(between), text(said(between).notice))).toEqual({ kind: 'between', detail: 'the edition ended 2027-05-23, and the text says so' });
    expect(verdict(answer(between), text('No upcoming fixture found for Arsenal.'))).toEqual({ kind: 'fail', detail: 'betweenEditions is not said in the text' });
  });

  it('an outage is reported as one', () => {
    expect(verdict(answer({ team: 'Arsenal', degraded: true }), text("Couldn't reach the data provider."))).toEqual({ kind: 'outage', detail: 'the provider could not be reached' });
  });

  it('a fixture: both clubs must be named on one line of the text, and a read that was not whole must say so there', () => {
    const fixture = { fixture: FIXTURE };
    expect(verdict(answer(fixture), text('Arsenal vs Chelsea', 'Oct 10 · 14:00 UTC'))).toEqual({ kind: 'ok', detail: 'a fixture' });
    // Both NAMES, on one line (the row): the header names Arsenal whatever the fixture, and a code is not a name.
    for (const row of ['ARS vs CHE', 'Arsenal vs', 'vs Chelsea', 'Arsenal vs CHE']) {
      expect(verdict(answer(fixture), text(row, 'Oct 10 · 14:00 UTC')), row).toEqual({ kind: 'fail', detail: 'the fixture is not in the text' });
    }
    expect(verdict(answer(fixture), text('Arsenal', 'vs', 'Chelsea'))).toEqual({ kind: 'fail', detail: 'the fixture is not in the text' });
    // A side the ANSWER does not name is the answer's defect, whatever the text says.
    for (const side of [{ id: 'espn:363', code: 'CHE' }, { ...CHE, name: '' }, null]) {
      const nameless = { fixture: { ...FIXTURE, away: side } };
      expect(verdict(answer(nameless), text('Arsenal vs Chelsea')), JSON.stringify(side)).toEqual({ kind: 'broken', detail: 'the fixture names no club on one side' });
    }
    const partial = { fixture: FIXTURE, partial: { omitted: 2 } };
    const qualifiers = said(partial).qualifiers;
    expect(qualifiers.length).toBeGreaterThan(0);
    expect(verdict(answer(partial), text(...qualifiers, 'Arsenal vs Chelsea'))).toEqual({ kind: 'ok', detail: 'a fixture, the read was not whole and the text says so' });
    expect(verdict(answer(partial), text('Arsenal vs Chelsea'))).toEqual({ kind: 'fail', detail: 'the partial read is not said in the text' });
  });

  it('no fixture READ in a span that was not whole: the none-read sentence and every qualifier must be in the text', () => {
    for (const partial of [{}, { omitted: 2 }]) {
      const over = { partial };
      const s = said(over);
      expect(s.qualifiers.length, JSON.stringify(partial)).toBeGreaterThan(0);
      expect(s.noneRead, JSON.stringify(partial)).not.toBe('');
      expect(verdict(answer(over), text(...s.qualifiers, s.noneRead)), JSON.stringify(partial)).toEqual({
        kind: 'ok',
        detail: 'no fixture READ in the span (the read was not whole), its sentence shown',
      });
      expect(verdict(answer(over), text(...s.qualifiers, 'No upcoming fixture found for Arsenal.')), JSON.stringify(partial)).toEqual({
        kind: 'fail',
        detail: 'the none-read sentence is not said in the text',
      });
      expect(verdict(answer(over), text(s.noneRead)), JSON.stringify(partial)).toEqual({
        kind: 'fail',
        detail: 'the partial read is not said in the text',
      });
    }
  });

  it('a horizon is believed only with a span: a positive whole number of days', () => {
    for (const horizon of [{}, { days: 'soon' }, { days: 0 }, { days: 14.5 }, { days: -1 }, 'x']) {
      const shown = text(said({ horizon: { days: 14 } }).horizon);
      expect(verdict(answer({ horizon }), shown), JSON.stringify(horizon)).toEqual({ kind: 'broken', detail: 'horizon states no span' });
    }
  });

  it('no fixture in the span (a whole read): the horizon sentence must be in the text', () => {
    const horizon = { horizon: { days: 14 } };
    const s = said(horizon);
    expect(s.horizon).not.toBe('');
    expect(verdict(answer(horizon), text(s.horizon))).toEqual({ kind: 'ok', detail: 'no fixture in the span, its sentence shown' });
    expect(verdict(answer(horizon), text('No upcoming fixture found for Arsenal.'))).toEqual({ kind: 'fail', detail: 'the horizon is not said in its text' });
  });

  it('no fixture, no horizon and no partial verdict is broken (next off the bundle has no such answer)', () => {
    expect(verdict(answer({}), text('No upcoming fixture found for Arsenal.'))).toEqual({
      kind: 'broken',
      detail: 'no fixture, no horizon and no partial verdict is not an answer next gives off the bundle',
    });
  });
});


describe('the club render: the script asks those decisions', () => {
  const script = readFileSync(SCRIPT, 'utf8');
  const code = script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const header = script
    .split('\n')
    .filter((line) => /^\s*#/.test(line))
    .join('\n')
    .replace(/\s+/g, ' ');

  it('decides from the header question it already asks, never from the environment variable', () => {
    expect(code).toContain('CLUB_GATE="$(cli table Z --json 2>/dev/null | qa club)"');
    expect(code).not.toMatch(/\$\{?CLAUDINHO_COMPETITION/);
  });

  it('follows the Premier League in a SECOND config directory, after the bundle pass, and removes it', () => {
    expect(code).toMatch(/QA_CLUB_CONFIG="\$\(mktemp -d/);
    expect(code).toMatch(/trap '[^']*rm -rf [^']*"\$\{QA_CLUB_CONFIG:-\}"[^']*' EXIT/);
    expect(code).toContain('club follow premier-league');
    expect(code.indexOf('club follow premier-league')).toBeGreaterThan(code.indexOf('run prompt'));
  });

  it('renders the club surfaces, never the bracket, and counts its failures into the one final count', () => {
    for (const asked of ['crun today', 'crun live', 'club next Arsenal --lang en', 'crun table', 'crun table LEAGUE', 'club next Arsenal --lang en --json', 'club table LEAGUE --lang pt']) {
      expect(code, asked).toContain(asked);
    }
    expect(code).not.toMatch(/(crun|club) bracket/);
    for (const q of ['qa club-followed', 'qa next ', 'qa next-disclaimer', 'qa pt-table', 'qa prompt']) expect(code, q).toContain(q);
    // One summary line, after the club checks.
    expect(code.lastIndexOf('qa prompt')).toBeLessThan(code.indexOf('bold "tripwires: $PASS passed'));
  });

  it('the club answer is read in English, the language its validator asks core for: its text once, its JSON once, and never again', () => {
    const asked = code.split('\n').map((l) => l.trim()).filter((l) => /club next Arsenal/.test(l));
    expect(asked).toEqual([
      'CLUB_NEXT_TEXT="$(club next Arsenal --lang en 2>/dev/null)"',
      'CLUB_NEXT_JSON="$(club next Arsenal --lang en --json 2>/dev/null)"',
    ]);
    // One read, one verdict: a second read could only replace a failure with a later answer.
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/read again|read_club_next|CLUB_FIRST_TEXT/);
    expect(code.split('\n').filter((l) => /qa next /.test(l))).toHaveLength(1);
    expect(code).toContain('qa next-disclaimer <<<"$CLUB_NEXT_TEXT"');
  });

  it('every club command reads and writes the temporary cache, never the operator\'s (club() exports both directories)', () => {
    const line = script.split('\n').find((l) => /^club\(\)\s*\{/.test(l)) ?? '';
    expect(line).toContain('XDG_CONFIG_HOME="$QA_CLUB_CONFIG"');
    expect(line).toContain('XDG_CACHE_HOME="$QA_CLUB_CACHE"');
    // Created before the first club command.
    expect(code.indexOf('QA_CLUB_CACHE="$(mktemp -d')).toBeLessThan(code.indexOf('club follow premier-league'));
  });

  it('seeds the prompt through the smoke\'s helper, in a cache directory of its own, and counts the refreshers it starts', () => {
    expect(code).toMatch(/QA_CLUB_CACHE="\$\(mktemp -d/);
    expect(code).toContain('scripts/statusline-seed.mjs" club "$QA_CLUB_CACHE"');
    expect(code).toContain('QA_SPAWN_LOG=');
    expect(code).toContain('spawn-count.mjs');
    expect(code).toMatch(/XDG_CACHE_HOME="\$QA_CLUB_CACHE"/);
  });

  it('states the added work in its header: the GETs, the timeout and the estimate', () => {
    expect(header).toMatch(/17 GETs/);
    expect(header).not.toMatch(/6 more/);
    expect(header).toMatch(/two months/);
    expect(header).toMatch(/6-second/);
    expect(header).toMatch(/under two minutes/);
  });
});

describe.skipIf(!existsSync(CLI_DIST))('the club render: the seeded prompt through the built CLI, with its refreshers counted', () => {
  const root = mkdtempSync(join(tmpdir(), 'claudinho-release-qa-club-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const SEED = pathToFileURL(path('../../../scripts/statusline-seed.mjs')).href; // a URL: a bare Windows path is no import specifier
  // `--import` takes a URL specifier: a bare Windows path (`D:\...`) is read as a scheme and refused
  // (ERR_UNSUPPORTED_ESM_URL_SCHEME), so the counter is named by its file URL, as the shell script names it.
  const COUNT = pathToFileURL(path('../../../scripts/spawn-count.mjs')).href;

  const prompt = async (name: string, at: Date) => {
    const dir = join(root, name);
    const config = join(dir, 'config');
    mkdirSync(join(config, 'claudinho'), { recursive: true });
    writeFileSync(join(config, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition: 'premier-league' }));
    const seed = (await import(SEED)) as { seedClub: (cacheHome: string, slug: string, now?: Date) => string };
    seed.seedClub(join(dir, 'cache'), 'eng.1', at);
    const log = join(dir, 'spawns.log');
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_CACHE_HOME: join(dir, 'cache'), XDG_CONFIG_HOME: config, QA_SPAWN_LOG: log };
    delete env.CLAUDINHO_COMPETITION;
    delete env.CLAUDINHO_TEAM;
    const out = execFileSync(process.execPath, ['--import', COUNT, CLI_DIST, 'prompt'], { env, encoding: 'utf8', input: '', timeout: 15_000 });
    const spawns = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    return { out, spawns };
  };

  it('a fresh seed renders the club match and starts no refresher', { timeout: 30_000 }, async () => {
    const { out, spawns } = await prompt('fresh', new Date());
    expect(out).toContain('ARS 2–1 CHE');
    expect(spawns).toEqual([]);
  });

  it('a stale seed is counted (the control: the count sees a refresher)', { timeout: 30_000 }, async () => {
    const { spawns } = await prompt('stale', new Date(Date.now() - 2 * 3600e3));
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toContain('_refresh');
  });
});

describe('the spawn counter starts nothing: its child is inert', () => {
  const COUNT = pathToFileURL(path('../../../scripts/spawn-count.mjs')).href;
  const SCRIPT_JS = [
    "import { ChildProcess, spawn } from 'node:child_process';",
    "const child = spawn(process.execPath, ['-e', '']);",
    'process.stdout.write(JSON.stringify({ pid: child.pid ?? null, real: child instanceof ChildProcess }));',
  ].join('\n');
  const run = (log: string | undefined) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.QA_SPAWN_LOG;
    if (log !== undefined) env.QA_SPAWN_LOG = log;
    return JSON.parse(
      execFileSync(process.execPath, ['--import', COUNT, '--input-type=module', '-e', SCRIPT_JS], { env, encoding: 'utf8', timeout: 15_000 }),
    ) as { pid: number | null; real: boolean };
  };

  it('with QA_SPAWN_LOG: the spawn is logged and no process is started', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudinho-spawn-count-'));
    try {
      const log = join(dir, 'spawns.log');
      expect(run(log)).toEqual({ pid: null, real: false });
      expect(readFileSync(log, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('without it: nothing changes (a real child, with a pid)', () => {
    const answer = run(undefined);
    expect(answer.real).toBe(true);
    expect(typeof answer.pid).toBe('number');
  });
});
