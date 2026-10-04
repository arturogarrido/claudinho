/**
 * `scripts/release-qa.sh` renders every surface against the live feed, so no
 * test runs it. What it DECIDES about the competition is in
 * `scripts/release-qa-lib.mjs` (0.11 · 2.5a), and is run here offline:
 *   - the default mode sets nothing: the CLI's own default (the World Cup)
 *     answers, and the header says so;
 *   - the drift tripwire is gated on the competition the built CLI RESOLVED
 *     (an alias is its slug), never on the raw environment value;
 *   - a competition the script cannot resolve, and a drift verdict it cannot
 *     read (an empty one included), FAIL: a broken check never reads as a
 *     quiet feed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { competitionLabel, driftGate, driftVerdict, resolvedSlug } from '../../../scripts/release-qa-lib.mjs';
import { BUNDLE_COMPETITION } from '../src';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SCRIPT = path('../../../scripts/release-qa.sh');
const CLI_DIST = path('../../cli/dist/index.js');

describe('the decisions, offline', () => {
  it('the header names the caller\'s competition, or the CLI\'s default', () => {
    expect(competitionLabel(undefined)).toBe('default (World Cup)');
    expect(competitionLabel('')).toBe('default (World Cup)');
    expect(competitionLabel('world-cup')).toBe('world-cup');
    expect(competitionLabel('fifa.friendly')).toBe('fifa.friendly');
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

  it('the header, the gate and the verdict go through the helper; the fallbacks FAIL', () => {
    expect(code).toContain('competition=$(qa label)');
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
  // A cache directory of its own: the CLI never reads the developer's.
  const cache = mkdtempSync(join(tmpdir(), 'claudinho-release-qa-'));
  afterAll(() => rmSync(cache, { recursive: true, force: true }));
  const ask = (env: string | undefined) => {
    const base: NodeJS.ProcessEnv = { ...process.env, XDG_CACHE_HOME: cache };
    delete base.CLAUDINHO_COMPETITION;
    if (env !== undefined) base.CLAUDINHO_COMPETITION = env;
    try {
      return execFileSync(process.execPath, [CLI_DIST, 'table', 'Z', '--json'], { env: base, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };

  it('nothing set, the alias and the slug are the World Cup; an unknown value resolves nothing', { timeout: 60_000 }, () => {
    for (const env of [undefined, 'world-cup', 'fifa.world']) {
      expect(resolvedSlug(ask(env)), String(env)).toBe(BUNDLE_COMPETITION);
    }
    expect(resolvedSlug(ask('foo'))).toBeUndefined();
  });
});
