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
 *     as one and proves no populated render ({@link clubCardVerdict},
 *     {@link ptTableVerdict}), the card carries the one disclaimer whatever it
 *     answered ({@link cardCarriesDisclaimer}), and the seeded prompt renders
 *     the seed and starts no refresher ({@link promptVerdict}).
 *
 * The script calls this file's command line:
 *   node scripts/release-qa-lib.mjs label  < json    the header's competition, as the CLI resolved it
 *   node scripts/release-qa-lib.mjs slug   < json    the slug the CLI resolved, or nothing
 *   node scripts/release-qa-lib.mjs gate <slug>      run | skip:<why> | fail:<why>
 *   node scripts/release-qa-lib.mjs verdict < out    ok:<detail> | fail:<detail> | skip:<detail> | broken
 *   node scripts/release-qa-lib.mjs club < json      run | skip:<why>      (the bundle pass's header JSON)
 *   node scripts/release-qa-lib.mjs club-header < json                     (the club config's `follow --json`)
 *   node scripts/release-qa-lib.mjs club-followed < json  ok | fail:<why>
 *   node scripts/release-qa-lib.mjs card < json      ok | between | outage | fail | broken, :<detail>  (`share next --json`)
 *   node scripts/release-qa-lib.mjs card-disclaimer < json  ok | fail:<why>
 *   node scripts/release-qa-lib.mjs snippet < json   the card's text, for the eyeball
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

/** A share card's `--json` answer, or undefined when it carries no snippet. */
function cardOf(shareJson) {
  try {
    const card = JSON.parse(shareJson);
    return card && typeof card.snippet === 'string' && card.snippet !== '' ? card : undefined;
  } catch {
    return undefined;
  }
}

/** The replacing verdicts a club card can state about the club or the competition: each is a failed render here. */
const REPLACING = ['unknownTeam', 'rosterIncomplete', 'noCompetition', 'unsupported', 'inapplicable'];

/** What is wrong with a card that is not this club render's next card, or undefined when nothing is. */
function notTheClubCard(card) {
  if (card.kind !== 'next') return `the card's kind is ${JSON.stringify(card.kind ?? null)}, not "next"`;
  const slug = card.competition?.slug;
  if (slug !== CLUB.slug) return `the card's competition is ${typeof slug === 'string' ? slug : 'not stated'}, not ${CLUB.slug}`;
  if (!Array.isArray(card.matches)) return "the card's matches is not a list";
  const team = card.team;
  const named = (typeof team === 'string' && team !== '') || (team !== null && typeof team === 'object' && typeof team.name === 'string');
  if (!named) return 'the card names no team (neither a name nor a club with a name)';
  return undefined;
}

/**
 * What the club card answered (`share next <team> --json`), and whether its
 * SNIPPET says so: a structured field is what the card states, the snippet is
 * what a reader sees, and the render passes only when the second says the
 * first. The sentences are core's own (`core`: `verdictNotice`,
 * `verdictQualifiers`, `nextHorizonSentence`, `nextNoneReadSentence`, handed
 * in), asked for and looked for in the snippet, never spelled here. The first
 * row that applies answers:
 *   - no JSON, or no snippet: `broken`;
 *   - not this render's next card (its kind, its competition, its matches, its
 *     team): `broken`, naming what is wrong; a `betweenEditions` with no date:
 *     `broken`;
 *   - candidates, or a replacing verdict about the club or the competition:
 *     `fail` (the club is in the table: a render that says otherwise failed);
 *   - between editions: `between` (a VALID render) when the snippet says the
 *     verdict's sentence, else `fail`;
 *   - an outage: `outage` (the shell reports it as one; it proves no
 *     populated card);
 *   - a fixture: `ok` when the snippet names both clubs and, on a read that
 *     was not whole, says so; else `fail`;
 *   - no fixture: `ok` when the snippet says the none-read sentence (a read
 *     that was not whole) or the horizon sentence (a whole read), else `fail`;
 *     an empty card with neither verdict is `broken` (no next card has it).
 */
export function clubCardVerdict(shareJson, core) {
  const card = cardOf(shareJson);
  if (!card) return { kind: 'broken', detail: 'the share command answered no card' };
  const wrong = notTheClubCard(card);
  if (wrong) return { kind: 'broken', detail: wrong };
  const between = card.betweenEditions;
  const statesBetween = between !== undefined;
  if (statesBetween && !(between !== null && typeof between === 'object' && typeof between.ended === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(between.ended))) {
    return { kind: 'broken', detail: 'betweenEditions states no date' };
  }
  if (Array.isArray(card.candidates) && card.candidates.length > 0) {
    return { kind: 'fail', detail: `"${CLUB.team}" resolved to ${card.candidates.length} clubs; the club render asks one name that must resolve` };
  }
  for (const key of REPLACING) {
    if (card[key] === true) return { kind: 'fail', detail: `the card answered ${key} for ${CLUB.team}` };
  }
  // The card as the sentence builders take a result: the query asked, the resolved club (when the card carries one), its fixture.
  const result = {
    ...card,
    query: CLUB.team,
    team: card.team !== null && typeof card.team === 'object' ? card.team : undefined,
    fixture: card.matches[0],
  };
  const says = (sentence) => typeof sentence === 'string' && sentence !== '' && card.snippet.includes(sentence);
  if (statesBetween) {
    if (!says(core.verdictNotice(result, 'en'))) return { kind: 'fail', detail: "the card's betweenEditions is not said in its snippet" };
    return { kind: 'between', detail: `the edition ended ${between.ended}, and the card says so` };
  }
  if (card.degraded === true) return { kind: 'outage', detail: 'the provider could not be reached, and the card says so' };
  const partial = typeof card.partial === 'object' && card.partial !== null;
  if (card.matches.length > 0) {
    const fixture = card.matches[0];
    if (!says(fixture?.home?.name) || !says(fixture?.away?.name)) return { kind: 'fail', detail: 'the fixture is not in the snippet' };
    if (partial) {
      const qualifiers = core.verdictQualifiers(result, 'en');
      if (qualifiers.length === 0 || !qualifiers.every(says)) return { kind: 'fail', detail: "the card's partial read is not said in its snippet" };
      return { kind: 'ok', detail: 'a fixture, the read was not whole and the card says so' };
    }
    return { kind: 'ok', detail: 'a fixture' };
  }
  if (partial) {
    if (!says(core.nextNoneReadSentence(result, CLUB.team, 'en'))) return { kind: 'fail', detail: "the card's none-read sentence is not said in its snippet" };
    return { kind: 'ok', detail: 'no fixture READ in the span (the read was not whole), its sentence shown' };
  }
  if (card.horizon !== null && typeof card.horizon === 'object') {
    if (!says(core.nextHorizonSentence(result, CLUB.team, 'en'))) return { kind: 'fail', detail: 'the horizon is not said in its snippet' };
    return { kind: 'ok', detail: 'no fixture in the span, its sentence shown' };
  }
  return { kind: 'broken', detail: 'an empty card with no horizon and no partial verdict is not a shape the next card has' };
}

/** The card carries the one disclaimer, whatever it answered. */
export function cardCarriesDisclaimer(shareJson, disclaimer) {
  const card = cardOf(shareJson);
  return Boolean(card) && typeof disclaimer === 'string' && disclaimer !== '' && card.snippet.includes(disclaimer);
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
  } else if (question === 'card') {
    // The sentences are core's: its builders read from the built package, as `card-disclaimer` reads the disclaimer.
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
    const core = existsSync(dist) ? await import(pathToFileURL(dist).href) : undefined;
    process.stdout.write(core === undefined ? 'fail:core dist not built — run pnpm -r build' : say(clubCardVerdict(stdin(), core)));
  } else if (question === 'card-disclaimer') {
    // The one disclaimer is core's: read from the built package, as the gate reads the bundled competition.
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
    const disclaimer = existsSync(dist) ? (await import(pathToFileURL(dist).href)).DISCLAIMER : undefined;
    process.stdout.write(
      disclaimer === undefined
        ? 'fail:core dist not built — run pnpm -r build'
        : cardCarriesDisclaimer(stdin(), disclaimer)
          ? 'ok'
          : 'fail:the club card does not carry the disclaimer',
    );
  } else if (question === 'snippet') {
    process.stdout.write(cardOf(stdin())?.snippet ?? '(no card)');
  } else if (question === 'pt-table') {
    process.stdout.write(say(ptTableVerdict(stdin())));
  } else if (question === 'prompt') {
    const { SEEDED_CLUB_MATCH } = await import('./statusline-seed.mjs');
    process.stdout.write(say(promptVerdict(stdin(), arg ?? '', SEEDED_CLUB_MATCH)));
  } else {
    process.stderr.write(
      'usage: release-qa-lib.mjs label | slug | gate <slug> | verdict | club | club-header | club-followed | card | card-disclaimer | snippet | pt-table | prompt <spawns>\n',
    );
    process.exit(2);
  }
}
