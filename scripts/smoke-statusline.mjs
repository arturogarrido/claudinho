#!/usr/bin/env node
/**
 * Cross-platform statusline smoke: seed a fresh micro-cache (through
 * `scripts/statusline-seed.mjs`, the one seed every script writes through), run
 * the built `claudinho prompt`, and assert it renders the seeded live match.
 * Plain node (no shell quoting) so the same command works on the Windows/macOS
 * CI legs.
 *
 * Since 0.11 nothing is followed until the user chooses, so the run FOLLOWS the
 * World Cup the way a user does: a config file (`{ version: 1, competition:
 * "world-cup" }`) in a config directory of its own (XDG_CONFIG_HOME), not
 * CLAUDINHO_COMPETITION. That way the smoke goes through the hot path's one
 * config read, which is what every installed statusline does on every tick,
 * and the cache it reads is the one keyed by the saved choice. It also checks
 * the first run: with no choice the binary prints `⚽ claudinho follow` and
 * exits 0, reading no cache.
 * Timing is printed for visibility but not asserted here — the hard bound lives
 * in packages/cli/test/hotpath-latency.test.ts.
 *
 *   pnpm -r build && node scripts/smoke-statusline.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The one cache seed every script writes through (pinned to the CLI's format
// and file name by packages/cli/test/smoke-cache-version.test.ts).
import { seedState } from './statusline-seed.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dist = join(root, 'packages', 'cli', 'dist', 'index.js');
if (!existsSync(dist)) {
  console.error('✗ packages/cli/dist not found — run `pnpm -r build` first.');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'claudinho-smoke-'));
try {
  const now = new Date().toISOString();
  // Fresh on BOTH cadences (live + fixtures) so the hot path spawns no refresher
  // and touches no network — this smoke must pass on an offline runner.
  seedState(dir, {
    competition: 'fifa.world',
    now,
    live: [
      {
        // Numeric: safeMatchId accepts only digits (every real ESPN and bundled
        // id is numeric), so a cache record with a prose-shaped id is dropped.
        id: '900001',
        stage: 'GROUP',
        group: 'A',
        kickoff: now,
        venue: 'Estadio Banorte',
        home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
        away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
        status: 'LIVE',
        minute: 30,
        score: { home: 1, away: 0 },
        updatedAt: now,
      },
    ],
    fixtures: [],
    fixturesUpdatedAt: now,
  });

  // The World Cup followed, as a user would (`claudinho follow world-cup`).
  const configDir = join(dir, 'config');
  mkdirSync(join(configDir, 'claudinho'), { recursive: true });
  writeFileSync(join(configDir, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition: 'world-cup' }));

  const env = { ...process.env, XDG_CACHE_HOME: dir, XDG_CONFIG_HOME: configDir, CLAUDINHO_FLAGS: 'on' };
  delete env.CLAUDINHO_TEAM;
  delete env.CLAUDINHO_COMPETITION;

  const t0 = performance.now();
  const out = execFileSync(process.execPath, [dist, 'prompt'], {
    env,
    encoding: 'utf8',
    input: '', // immediate stdin EOF — the Cursor-payload drain must not block
    timeout: 15_000,
  });
  const ms = performance.now() - t0;

  if (!out.includes('🇲🇽') && !out.includes('MEX')) {
    console.error(`✗ statusline did not render the seeded match. Output: ${JSON.stringify(out)}`);
    process.exit(1);
  }
  console.log(`✓ statusline smoke (${ms.toFixed(0)}ms): ${out.trim()}`);

  // The first run: nothing chosen (an empty config directory, no environment).
  const firstRun = execFileSync(process.execPath, [dist, 'prompt'], {
    env: { ...env, XDG_CONFIG_HOME: join(dir, 'empty-config') },
    encoding: 'utf8',
    input: '',
    timeout: 15_000,
  });
  if (firstRun.trim() !== '⚽ claudinho follow') {
    console.error(`✗ with nothing chosen the statusline should read "⚽ claudinho follow". Output: ${JSON.stringify(firstRun)}`);
    process.exit(1);
  }
  console.log(`✓ statusline first run: ${firstRun.trim()}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
