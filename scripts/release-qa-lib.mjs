/**
 * The decisions `scripts/release-qa.sh` makes about the competition it
 * renders, as pure functions a test runs offline (the script itself needs the
 * live feed, so nothing else can run it in CI).
 *
 *   - The competition the run is FOR is the one the built CLI resolved, never
 *     the raw `CLAUDINHO_COMPETITION`: an alias (`world-cup`) is the World Cup
 *     too, and with nothing set the run FOLLOWS the World Cup in a config
 *     directory of its own (the CLI has no default since 0.11: nothing chosen is
 *     no competition), which the caller's environment still overrides, as it
 *     does for a user. The script asks the CLI
 *     itself (`--json` on a competition-answering command carries
 *     `competition.slug`) and hands the answer to {@link resolvedSlug}.
 *   - The bundle-to-live drift tripwire runs only for the bundled competition
 *     ({@link driftGate}), and a verdict it cannot read is a FAILED check, never
 *     a skip ({@link driftVerdict}): an empty verdict once hid a stale call in
 *     the script behind "feed unreachable".
 *
 *   - The club render (0.11 · 2.7): after the bundle pass, a short render of
 *     a club competition ({@link CLUB}, followed in a SECOND config directory)
 *     and a seeded `prompt`. It runs unless the header the script already
 *     prints says the environment chose the competition ({@link clubPass}: the
 *     run is then one pass of that competition), and its renders are judged
 *     here: a between-editions league is a VALID render, an outage is reported
 *     as one and proves no populated render ({@link clubNextVerdict},
 *     {@link ptTableVerdict}), the club's `next` answer carries the one
 *     disclaimer whatever it answered ({@link textCarriesDisclaimer}), and the
 *     seeded prompt renders the seed and starts no refresher
 *     ({@link promptVerdict}).
 *
 * The script calls this file's command line:
 *   node scripts/release-qa-lib.mjs label  < json    the header's competition, as the CLI resolved it
 *   node scripts/release-qa-lib.mjs slug   < json    the slug the CLI resolved, or nothing
 *   node scripts/release-qa-lib.mjs gate <slug>      run | skip:<why> | fail:<why>
 *   node scripts/release-qa-lib.mjs verdict < out    ok:<detail> | fail:<detail> | skip:<detail> | broken
 *   node scripts/release-qa-lib.mjs club < json      run | skip:<why>      (the bundle pass's header JSON)
 *   node scripts/release-qa-lib.mjs club-header < json                     (the club config's `follow --json`)
 *   node scripts/release-qa-lib.mjs club-followed < json  ok | fail:<why>
 *   node scripts/release-qa-lib.mjs next <text> < json  ok | between | outage | fail | broken, :<detail>  (`next --json`, and its text)
 *   node scripts/release-qa-lib.mjs next-disclaimer < text  ok | fail:<why>
 *   node scripts/release-qa-lib.mjs pt-table < text  ok | skip | fail | broken, :<detail>
 *   node scripts/release-qa-lib.mjs prompt <spawns> < out   ok | fail | broken, :<detail>
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The header's competition, read back from the CLI's `--json` answer (never
 * assumed from the environment): where the choice came from and its name
 * (`saved (World Cup)`, `env (Premier League)`); `none chosen` when the CLI
 * answered `noCompetition` (the run's `follow` failed and nothing else chose);
 * `unresolved` when the answer carries no competition (a refused value).
 */
export function competitionLabel(jsonText) {
  try {
    const answer = JSON.parse(jsonText);
    if (answer?.noCompetition === true) return 'none chosen';
    const c = answer?.competition;
    if (c && typeof c.chosenBy === 'string' && typeof c.name === 'string' && c.name !== '') return `${c.chosenBy} (${c.name})`;
  } catch {
    // Not JSON: nothing was resolved.
  }
  return 'unresolved';
}

/**
 * The slug the CLI resolved, read from its `--json` answer (`competition.slug`);
 * undefined when the answer is not JSON or carries none (a refused value
 * exits with an error and prints nothing on stdout).
 */
export function resolvedSlug(jsonText) {
  try {
    const slug = JSON.parse(jsonText)?.competition?.slug;
    return typeof slug === 'string' && slug !== '' ? slug : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the drift tripwire runs for the competition the CLI resolved: only
 * for the bundled one (the schedule ships for it alone). A competition the
 * script could not resolve is a FAILED check: the run cannot say what it
 * rendered.
 */
export function driftGate(slug, bundle) {
  if (slug === undefined) return { kind: 'fail', detail: 'the built CLI resolved no competition (is CLAUDINHO_COMPETITION an alias or a slug?)' };
  if (slug !== bundle) return { kind: 'skip', detail: `non-default competition ${slug}: the bundled schedule is ${bundle}` };
  return { kind: 'run' };
}

/**
 * What the drift block printed, as a check: `DRIFT-OK <n>`, `DRIFT-FAIL
 * <ids>`, `DRIFT-SKIP` (the feed was unreachable or empty), and anything else,
 * the empty output included, is `broken`: the check itself did not run.
 */
export function driftVerdict(output) {
  const text = typeof output === 'string' ? output.trim() : '';
  if (text.startsWith('DRIFT-OK')) return { kind: 'ok', detail: text.slice('DRIFT-OK'.length).trim() };
  if (text.startsWith('DRIFT-FAIL')) return { kind: 'fail', detail: text.slice('DRIFT-FAIL'.length).trim() };
  if (text === 'DRIFT-SKIP') return { kind: 'skip', detail: 'feed unreachable/empty' };
  return { kind: 'broken', detail: text };
}

/** The club competition the club render follows, and the team it asks for. */
export const CLUB = Object.freeze({ alias: 'premier-league', slug: 'eng.1', team: 'Arsenal' });

/** The competition a `--json` answer resolved, or undefined (not JSON, or none resolved). */
function competitionOf(jsonText) {
  try {
    const c = JSON.parse(jsonText)?.competition;
    return c && typeof c === 'object' && typeof c.chosenBy === 'string' ? c : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the club render runs, decided from the header the script already
 * prints (the bundle pass's `--json`, read back), never from the environment
 * variable: when the environment chose the competition the run is one pass of
 * that competition, and when the bundle pass resolved none there is nothing to
 * follow a second one beside (the same refused value would refuse it too).
 */
export function clubPass(headerJson) {
  const c = competitionOf(headerJson);
  if (!c) return { kind: 'skip', detail: 'the bundle pass resolved no competition' };
  if (c.chosenBy === 'env') {
    return { kind: 'skip', detail: `the environment chose ${c.name ?? c.slug}: one pass of that competition` };
  }
  return { kind: 'run' };
}

/** The club render's header line: what the club config resolved, read back from its `follow --json`. */
export function clubHeader(followJson) {
  return `club render · competition=${competitionLabel(followJson)}`;
}

/** The club config follows the club competition, or the render says nothing about it. */
export function clubFollowed(followJson) {
  const slug = resolvedSlug(followJson);
  if (slug === CLUB.slug) return { kind: 'ok' };
  return { kind: 'fail', detail: `the club config resolved ${slug ?? 'no competition'}, not ${CLUB.slug}` };
}

/** A plain object (not null, not a list). */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `next --json`'s answer, or undefined when it is not a JSON object. */
function answerOf(nextJson) {
  try {
    const answer = JSON.parse(nextJson);
    return isObject(answer) ? answer : undefined;
  } catch {
    return undefined;
  }
}

/** The replacing verdicts `next` can state about the club or the competition: each is a failed render here. */
const REPLACING = ['unknownTeam', 'rosterIncomplete', 'noCompetition', 'unsupported', 'inapplicable'];

/** What is wrong with an answer that is not this club render's `next`, or undefined when nothing is. */
function notTheClubAnswer(answer) {
  const slug = answer.competition?.slug;
  if (slug !== CLUB.slug) return `the answer's competition is ${typeof slug === 'string' ? slug : 'not stated'}, not ${CLUB.slug}`;
  if (answer.fixture !== null && !isObject(answer.fixture)) return "the answer's fixture is neither null nor a match";
  const team = answer.team;
  const named = (typeof team === 'string' && team !== '') || (isObject(team) && typeof team.name === 'string');
  if (!named) return 'the answer names no team (neither a name nor a club with a name)';
  return undefined;
}

/**
 * What the club's `next` answered (`next <team> --json`), and whether its TEXT
 * (`next <team>`) says so: a structured field is what the answer states, the
 * text is what a reader sees, and the render passes only when the second says
 * the first (they are two requests: a feed change between them that the text
 * shows fails this run, which is run again). The sentences are core's own
 * (`core`: `verdictNotice`, `verdictQualifiers`, `nextHorizonSentence`,
 * `nextNoneReadSentence`, `t`, handed in), asked for and looked for in the
 * text, never spelled here. They are
 * asked for in ENGLISH because the script renders both in English (`next
 * Arsenal --lang en`: the flag wins over CLAUDINHO_LANG and LANG, so the
 * operator's language cannot fail a valid answer). The first row that applies
 * answers:
 *   - no JSON object, or no text: `broken`;
 *   - not this render's answer (its competition, its fixture, its team):
 *     `broken`, naming what is wrong; a `betweenEditions` with no date:
 *     `broken`;
 *   - candidates, or a replacing verdict about the club or the competition:
 *     `fail` (the club is in the table: a render that says otherwise failed);
 *   - between editions: `between` (a VALID render) when the text says the
 *     verdict's sentence, else `fail`;
 *   - an outage: `outage` (the shell reports it as one; it proves no
 *     populated render) when the text says core's outage sentence, else
 *     `fail`;
 *   - a fixture with a side that has no name: `broken`;
 *   - a fixture: `ok` when one line of the text holds both clubs' names
 *     and the text says the read was not whole when, and only when, the
 *     answer does; else `fail` (a text whose own read was not whole but that
 *     prints no qualifier, beside a whole JSON answer, is not detected);
 *   - no fixture, a read that was not whole: `ok` when the text says the
 *     none-read sentence AND every qualifier sentence, else `fail`;
 *   - no fixture, a whole read: a horizon with no span (`days` not a positive
 *     whole number) is `broken`; `ok` when the text says the horizon
 *     sentence, else `fail`; an answer with neither is `broken` (`next` off
 *     the bundle gives none).
 */
export function clubNextVerdict(nextJson, nextText, core) {
  const answer = answerOf(nextJson);
  if (!answer) return { kind: 'broken', detail: 'the next command answered no JSON' };
  const text = typeof nextText === 'string' ? nextText : '';
  if (text === '') return { kind: 'broken', detail: 'the next command printed nothing' };
  const wrong = notTheClubAnswer(answer);
  if (wrong) return { kind: 'broken', detail: wrong };
  const between = answer.betweenEditions;
  const statesBetween = between !== undefined;
  if (statesBetween && !(isObject(between) && typeof between.ended === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(between.ended))) {
    return { kind: 'broken', detail: 'betweenEditions states no date' };
  }
  if (Array.isArray(answer.candidates) && answer.candidates.length > 0) {
    return { kind: 'fail', detail: `"${CLUB.team}" resolved to ${answer.candidates.length} clubs; the club render asks one name that must resolve` };
  }
  for (const key of REPLACING) {
    if (answer[key] === true) return { kind: 'fail', detail: `next answered ${key} for ${CLUB.team}` };
  }
  // The answer as the sentence builders take a result: the query asked, the
  // resolved club (when the answer carries one), its fixture (when it has one).
  const { team, fixture, ...rest } = answer;
  const result = { ...rest, query: CLUB.team, ...(isObject(team) ? { team } : {}), ...(isObject(fixture) ? { fixture } : {}) };
  const says = (sentence) => typeof sentence === 'string' && sentence !== '' && text.includes(sentence);
  const saysEvery = (sentences) => sentences.length > 0 && sentences.every(says);
  if (statesBetween) {
    if (!says(core.verdictNotice(result, 'en'))) return { kind: 'fail', detail: 'betweenEditions is not said in the text' };
    return { kind: 'between', detail: `the edition ended ${between.ended}, and the text says so` };
  }
  if (answer.degraded === true) {
    if (!says(core.t('en', 'live.degraded'))) return { kind: 'fail', detail: 'the outage is not said in the text' };
    return { kind: 'outage', detail: 'the provider could not be reached' };
  }
  const partial = isObject(answer.partial);
  if (isObject(fixture)) {
    // A side with no name is the answer's own defect, whatever the text says.
    const sides = [fixture.home, fixture.away];
    if (!sides.every((s) => isObject(s) && typeof s.name === 'string' && s.name !== '')) {
      return { kind: 'broken', detail: 'the fixture names no club on one side' };
    }
    // Both NAMES on one line, the fixture's row: the header names the club asked whatever the fixture, and a code is no name.
    const names = sides.map((s) => s.name);
    if (!text.split('\n').some((line) => names.every((n) => line.includes(n)))) {
      return { kind: 'fail', detail: 'the fixture is not in the text' };
    }
    if (partial) {
      if (!saysEvery(core.verdictQualifiers(result, 'en'))) return { kind: 'fail', detail: 'the partial read is not said in the text' };
      return { kind: 'ok', detail: 'a fixture, the read was not whole and the text says so' };
    }
    // Core's qualifier for a read that was not whole: uncounted, one record, or
    // any count (built with a sentinel count, matched with digits in its place).
    const sentinel = 987654321;
    const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const counted = core.verdictQualifiers({ partial: { omitted: sentinel } }, 'en').map((s) => s.split(String(sentinel)));
    if (
      [{}, { omitted: 1 }].some((p) => core.verdictQualifiers({ partial: p }, 'en').some(says)) ||
      counted.some((parts) => parts.length === 2 && new RegExp(`${escaped(parts[0])}\\d+${escaped(parts[1])}`).test(text))
    ) {
      return { kind: 'fail', detail: 'the text says the read was not whole and the answer does not' };
    }
    return { kind: 'ok', detail: 'a fixture' };
  }
  if (partial) {
    if (!says(core.nextNoneReadSentence(result, CLUB.team, 'en'))) return { kind: 'fail', detail: 'the none-read sentence is not said in the text' };
    if (!saysEvery(core.verdictQualifiers(result, 'en'))) return { kind: 'fail', detail: 'the partial read is not said in the text' };
    return { kind: 'ok', detail: 'no fixture READ in the span (the read was not whole), its sentence shown' };
  }
  if (answer.horizon !== undefined) {
    const days = answer.horizon?.days;
    if (!isObject(answer.horizon) || !(Number.isInteger(days) && days > 0)) return { kind: 'broken', detail: 'horizon states no span' };
    if (!says(core.nextHorizonSentence(result, CLUB.team, 'en'))) return { kind: 'fail', detail: 'the horizon is not said in its text' };
    return { kind: 'ok', detail: 'no fixture in the span, its sentence shown' };
  }
  return { kind: 'broken', detail: 'no fixture, no horizon and no partial verdict is not an answer next gives off the bundle' };
}

/** A text carries the one disclaimer (both non-empty), whatever it answered. */
export function textCarriesDisclaimer(text, disclaimer) {
  return typeof text === 'string' && text !== '' && typeof disclaimer === 'string' && disclaimer !== '' && text.includes(disclaimer);
}

/**
 * The Portuguese club table (`table LEAGUE --lang pt`): the first line with a
 * `│` is the table's header row, and its first cell must be "Time", the word
 * the other PT strings use for a team; any other header FAILS, naming it (the
 * English "Team", "Seleção", anything). A render with no box row at all (an
 * outage, or no table this edition) is reported, never passed: it proves no
 * table rendered.
 */
export function ptTableVerdict(text) {
  const t = typeof text === 'string' ? text : '';
  if (t.trim() === '') return { kind: 'broken', detail: 'nothing rendered' };
  const header = t.split('\n').find((line) => line.includes('│'));
  if (header === undefined) return { kind: 'skip', detail: 'no table rendered; the text above says why' };
  const cell = (header.split('│')[1] ?? '').trim();
  if (cell === 'Time') return { kind: 'ok', detail: 'the team column says Time' };
  return { kind: 'fail', detail: `the team column says ${cell}` };
}

/**
 * The seeded `prompt`: it renders the seeded club match (`seeded`, the
 * statusline's tokens for it) and starts no refresher (`spawns`, the count the
 * spawn counter recorded). A count that is not a count is broken.
 */
export function promptVerdict(output, spawns, seeded) {
  const raw = typeof spawns === 'string' ? spawns.trim() : '';
  if (!/^\d+$/.test(raw)) return { kind: 'broken', detail: `no spawn count (${JSON.stringify(spawns)})` };
  const n = Number(raw);
  const line = typeof output === 'string' ? output.trim() : '';
  if (n > 0) return { kind: 'fail', detail: `prompt started ${n} refresher(s) on a fresh seed` };
  if (!line.includes(seeded)) return { kind: 'fail', detail: `the statusline did not render the seeded match: ${JSON.stringify(line)}` };
  return { kind: 'ok', detail: line };
}

const say = (r) => `${r.kind}${r.detail !== undefined ? `:${r.detail}` : ''}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [question, arg] = process.argv.slice(2);
  const stdin = () => {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      return '';
    }
  };
  if (question === 'label') {
    process.stdout.write(competitionLabel(stdin()));
  } else if (question === 'slug') {
    process.stdout.write(resolvedSlug(stdin()) ?? '');
  } else if (question === 'gate') {
    // The bundled competition is core's: read from the built package.
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
    const bundle = existsSync(dist) ? (await import(pathToFileURL(dist).href)).BUNDLE_COMPETITION : undefined;
    process.stdout.write(
      bundle === undefined ? 'fail:core dist not built — run pnpm -r build' : say(driftGate(arg || undefined, bundle)),
    );
  } else if (question === 'verdict') {
    process.stdout.write(say(driftVerdict(stdin())));
  } else if (question === 'club') {
    process.stdout.write(say(clubPass(stdin())));
  } else if (question === 'club-header') {
    process.stdout.write(clubHeader(stdin()));
  } else if (question === 'club-followed') {
    process.stdout.write(say(clubFollowed(stdin())));
  } else if (question === 'next') {
    // The JSON on standard input, the text as the argument. The sentences are
    // core's: its builders read from the built package, as `next-disclaimer`
    // reads the disclaimer.
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
    const core = existsSync(dist) ? await import(pathToFileURL(dist).href) : undefined;
    process.stdout.write(core === undefined ? 'fail:core dist not built — run pnpm -r build' : say(clubNextVerdict(stdin(), arg ?? '', core)));
  } else if (question === 'next-disclaimer') {
    // The one disclaimer is core's: read from the built package, as the gate reads the bundled competition.
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
    const disclaimer = existsSync(dist) ? (await import(pathToFileURL(dist).href)).DISCLAIMER : undefined;
    process.stdout.write(
      disclaimer === undefined
        ? 'fail:core dist not built — run pnpm -r build'
        : textCarriesDisclaimer(stdin(), disclaimer)
          ? 'ok'
          : 'fail:the club answer does not carry the disclaimer',
    );
  } else if (question === 'pt-table') {
    process.stdout.write(say(ptTableVerdict(stdin())));
  } else if (question === 'prompt') {
    const { SEEDED_CLUB_MATCH } = await import('./statusline-seed.mjs');
    process.stdout.write(say(promptVerdict(stdin(), arg ?? '', SEEDED_CLUB_MATCH)));
  } else {
    process.stderr.write(
      'usage: release-qa-lib.mjs label | slug | gate <slug> | verdict | club | club-header | club-followed | next <text> | next-disclaimer | pt-table | prompt <spawns>\n',
    );
    process.exit(2);
  }
}
