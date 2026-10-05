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

  it('`card` asks the built core\'s sentence builders (a horizon card whose snippet says its horizon is a render)', () => {
    const text = `Next up for Arsenal · Premier League\n\n${nextHorizonSentence({ horizon: { days: 14 }, query: 'Arsenal' } as never, 'Arsenal', 'en')}\n\n${DISCLAIMER}`;
    const json = JSON.stringify({ kind: 'next', team: 'Arsenal', snippet: text, matches: [], horizon: { days: 14 }, competition: { slug: 'eng.1', name: 'Premier League', chosenBy: 'saved' } });
    expect(run(['card'], json)).toBe('ok:no fixture in the span, its sentence shown');
    // The same card whose snippet does not say its horizon: the built core's sentence is what is asked for.
    expect(run(['card'], json.replace(/No fixture for Arsenal[^\\]*days\./, 'Nothing.'))).toBe('fail:the horizon is not said in its snippet');
    expect(run(['card'], '')).toBe('broken:the share command answered no card');
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

  it('the club card carries the one disclaimer, whatever it answered (an outage and between editions included)', () => {
    const card = (snippet: string, extra: Record<string, unknown> = {}) => JSON.stringify({ kind: 'next', snippet, ...extra });
    expect(qaLib.cardCarriesDisclaimer(card(`x\n${DISCLAIMER}`), DISCLAIMER)).toBe(true);
    expect(qaLib.cardCarriesDisclaimer(card(`x\n${DISCLAIMER}`, { degraded: true }), DISCLAIMER)).toBe(true);
    expect(qaLib.cardCarriesDisclaimer(card('x\nIndependent fan project · not affiliated with FIFA or Anthropic.'), DISCLAIMER)).toBe(false);
    expect(qaLib.cardCarriesDisclaimer('', DISCLAIMER)).toBe(false);
    expect(qaLib.cardCarriesDisclaimer(card(`x\n${DISCLAIMER}`), '')).toBe(false);
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
 * The club card (0.11 · 2.7, review round 1): `clubCardVerdict` asks the card
 * what it answered and asks the SNIPPET whether it says so, with core's own
 * sentence builders handed in. One case per row of its table, in its order.
 */
describe('the club card: what it answered, and whether its snippet says so', () => {
  const CORE = { verdictNotice, verdictQualifiers, nextHorizonSentence, nextNoneReadSentence };
  const ARS = { id: 'espn:359', code: 'ARS', name: 'Arsenal' };
  const CHE = { id: 'espn:363', code: 'CHE', name: 'Chelsea' };
  const FIXTURE = { id: '800000011', stage: 'REGULAR', kickoff: '2026-10-10T14:00:00.000Z', venue: 'Emirates Stadium', home: ARS, away: CHE, status: 'SCHEDULED', updatedAt: '2026-10-04T12:00:00.000Z' };
  const PL = { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' };
  const FOOTER = `#VibingLaVidaLoca · Independent fan project · ${DISCLAIMER}`;
  const snippet = (...body: string[]) => ['Next up for Arsenal · Premier League', '', ...body, '', FOOTER].join('\n');
  const card = (over: Record<string, unknown>, text: string) =>
    JSON.stringify({ kind: 'next', target: 'next', team: ARS, snippet: text, matches: [], competition: PL, ...over });
  // The sentence a card of this shape prints, from core's builders (never spelled here).
  const said = (over: Record<string, unknown>) => {
    const result = { team: ARS, query: 'Arsenal', ...over } as never;
    return {
      notice: verdictNotice(result, 'en') ?? '',
      qualifiers: verdictQualifiers(result, 'en'),
      horizon: nextHorizonSentence(result, 'Arsenal', 'en') ?? '',
      noneRead: nextNoneReadSentence(result, 'Arsenal', 'en') ?? '',
    };
  };
  const verdict = (json: string) => qaLib.clubCardVerdict(json, CORE);

  it('no JSON, or no snippet: broken, the share command answered no card', () => {
    for (const json of ['', 'not json', JSON.stringify({ kind: 'next', matches: [], competition: PL, team: ARS }), card({}, '')]) {
      expect(verdict(json), json).toEqual({ kind: 'broken', detail: 'the share command answered no card' });
    }
  });

  it('a card that is not this club render\'s next card is broken, and says what is wrong', () => {
    const text = snippet(said({ horizon: { days: 14 } }).horizon);
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ kind: 'date' }, /kind/],
      [{ kind: undefined }, /kind/],
      [{ competition: { ...PL, slug: 'fifa.world' } }, /fifa\.world|competition/],
      [{ competition: undefined }, /competition/],
      [{ matches: undefined }, /matches/],
      [{ matches: 'none' }, /matches/],
      [{ team: undefined }, /team/],
      [{ team: '' }, /team/],
      [{ team: { code: 'ARS' } }, /team/],
    ];
    for (const [over, why] of cases) {
      const v = verdict(card({ horizon: { days: 14 }, ...over }, text));
      expect(v.kind, JSON.stringify(over)).toBe('broken');
      expect(v.detail, JSON.stringify(over)).toMatch(why);
    }
  });

  it('a betweenEditions that states no date is broken', () => {
    for (const between of [{}, { ended: 'soon' }, { ended: 20270523 }, 'yes', true]) {
      expect(verdict(card({ betweenEditions: between }, snippet('x'))), JSON.stringify(between)).toEqual({ kind: 'broken', detail: 'betweenEditions states no date' });
    }
  });

  it('candidates: Arsenal resolved to several clubs, a failed render', () => {
    const v = verdict(card({ team: 'Arsenal', candidates: [ARS, { id: 'espn:9', code: 'ARW', name: 'Arsenal Women' }] }, snippet('"Arsenal" is ambiguous.')));
    expect(v).toEqual({ kind: 'fail', detail: '"Arsenal" resolved to 2 clubs; the club render asks one name that must resolve' });
  });

  it('a replacing verdict about the club, or the competition, is a failed render', () => {
    for (const key of ['unknownTeam', 'rosterIncomplete', 'noCompetition', 'unsupported', 'inapplicable']) {
      const v = verdict(card({ team: 'Arsenal', [key]: true }, snippet(said({ [key]: true }).notice)));
      expect(v, key).toEqual({ kind: 'fail', detail: `the card answered ${key} for Arsenal` });
    }
  });

  it('between editions is a VALID render when the snippet says so, and a failed one when it does not', () => {
    const between = { betweenEditions: { ended: '2027-05-23' } };
    expect(verdict(card(between, snippet(said(between).notice)))).toEqual({ kind: 'between', detail: 'the edition ended 2027-05-23, and the card says so' });
    expect(verdict(card(between, snippet('No upcoming fixture found for Arsenal.')))).toEqual({ kind: 'fail', detail: "the card's betweenEditions is not said in its snippet" });
  });

  it('an outage is reported as one', () => {
    expect(verdict(card({ team: 'Arsenal', degraded: true }, snippet("Couldn't reach the data provider.")))).toEqual({ kind: 'outage', detail: 'the provider could not be reached, and the card says so' });
  });

  it('a fixture: its two clubs must be in the snippet, and a read that was not whole must say so there', () => {
    const fixture = { matches: [FIXTURE] };
    expect(verdict(card(fixture, snippet('Arsenal vs Chelsea', 'Oct 10 · 14:00 UTC')))).toEqual({ kind: 'ok', detail: 'a fixture' });
    expect(verdict(card(fixture, snippet('Arsenal vs', 'Oct 10 · 14:00 UTC')))).toEqual({ kind: 'fail', detail: 'the fixture is not in the snippet' });
    const partial = { matches: [FIXTURE], partial: { omitted: 2 } };
    const qualifiers = said({ ...partial, fixture: FIXTURE }).qualifiers;
    expect(qualifiers.length).toBeGreaterThan(0);
    expect(verdict(card(partial, snippet(...qualifiers, '', 'Arsenal vs Chelsea')))).toEqual({ kind: 'ok', detail: 'a fixture, the read was not whole and the card says so' });
    expect(verdict(card(partial, snippet('Arsenal vs Chelsea')))).toEqual({ kind: 'fail', detail: "the card's partial read is not said in its snippet" });
  });

  it('no fixture READ in a span that was not whole: the none-read sentence must be in the snippet', () => {
    const partial = { partial: {} };
    const s = said(partial);
    expect(s.noneRead).not.toBe('');
    expect(verdict(card(partial, snippet(...s.qualifiers, s.noneRead)))).toEqual({ kind: 'ok', detail: 'no fixture READ in the span (the read was not whole), its sentence shown' });
    const missing = verdict(card(partial, snippet(...s.qualifiers, 'No upcoming fixture found for Arsenal.')));
    expect(missing.kind).toBe('fail');
  });

  it('an empty partial card must say its qualifier too: the none-read sentence alone is not enough', () => {
    for (const partial of [{}, { omitted: 2 }]) {
      const over = { partial };
      const s = said(over);
      expect(s.qualifiers.length, JSON.stringify(partial)).toBeGreaterThan(0);
      expect(s.noneRead, JSON.stringify(partial)).not.toBe('');
      expect(verdict(card(over, snippet(...s.qualifiers, s.noneRead))), JSON.stringify(partial)).toEqual({
        kind: 'ok',
        detail: 'no fixture READ in the span (the read was not whole), its sentence shown',
      });
      expect(verdict(card(over, snippet(s.noneRead))), JSON.stringify(partial)).toEqual({
        kind: 'fail',
        detail: "the card's partial read is not said in its snippet",
      });
    }
  });

  it('a horizon is believed only with a span: a positive whole number of days', () => {
    for (const horizon of [{}, { days: 'soon' }, { days: 0 }, { days: 14.5 }, { days: -1 }, null, 'x']) {
      const text = snippet(said({ horizon: { days: 14 } }).horizon);
      expect(verdict(card({ horizon }, text)), JSON.stringify(horizon)).toEqual({ kind: 'broken', detail: 'horizon states no span' });
    }
  });

  it('no fixture in the span (a whole read): the horizon sentence must be in the snippet', () => {
    const horizon = { horizon: { days: 14 } };
    const s = said(horizon);
    expect(s.horizon).not.toBe('');
    expect(verdict(card(horizon, snippet(s.horizon)))).toEqual({ kind: 'ok', detail: 'no fixture in the span, its sentence shown' });
    expect(verdict(card(horizon, snippet('No upcoming fixture found for Arsenal.')))).toEqual({ kind: 'fail', detail: 'the horizon is not said in its snippet' });
  });

  it('an empty card with no horizon and no partial verdict is broken (the next card has no such shape)', () => {
    expect(verdict(card({}, snippet('No upcoming fixture found for Arsenal.')))).toEqual({
      kind: 'broken',
      detail: 'an empty card with no horizon and no partial verdict is not a shape the next card has',
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
    for (const asked of ['crun today', 'crun live', 'crun next Arsenal', 'crun table', 'crun table LEAGUE', 'club share next Arsenal --lang en --json', 'club table LEAGUE --lang pt']) {
      expect(code, asked).toContain(asked);
    }
    expect(code).not.toMatch(/(crun|club) (share )?bracket/);
    for (const q of ['qa club-followed', 'qa card', 'qa card-disclaimer', 'qa pt-table', 'qa prompt']) expect(code, q).toContain(q);
    // One summary line, after the club checks.
    expect(code.lastIndexOf('qa prompt')).toBeLessThan(code.indexOf('bold "tripwires: $PASS passed'));
  });

  it('the club card is rendered in English, the language its validator asks core for (the flag wins over CLAUDINHO_LANG and LANG)', () => {
    const asked = code.split('\n').filter((l) => /club share next Arsenal/.test(l));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('CLUB_CARD="$(club share next Arsenal --lang en --json 2>/dev/null)"');
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
