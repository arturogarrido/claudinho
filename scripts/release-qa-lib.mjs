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
 * The script calls this file's command line:
 *   node scripts/release-qa-lib.mjs label  < json    the header's competition, as the CLI resolved it
 *   node scripts/release-qa-lib.mjs slug   < json    the slug the CLI resolved, or nothing
 *   node scripts/release-qa-lib.mjs gate <slug>      run | skip:<why> | fail:<why>
 *   node scripts/release-qa-lib.mjs verdict < out    ok:<detail> | fail:<detail> | skip:<detail> | broken
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
  } else {
    process.stderr.write('usage: release-qa-lib.mjs label | slug | gate <slug> | verdict\n');
    process.exit(2);
  }
}
