#!/usr/bin/env node
/**
 * Cross-platform statusline smoke: seed a fresh micro-cache, run the built
 * `claudinho prompt`, and assert it renders the seeded live match. Plain node
 * (no shell quoting) so the same command works on the Windows/macOS CI legs.
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

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dist = join(root, 'packages', 'cli', 'dist', 'index.js');
if (!existsSync(dist)) {
  console.error('✗ packages/cli/dist not found — run `pnpm -r build` first.');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'claudinho-smoke-'));
try {
  const cacheDir = join(dir, 'claudinho');
  mkdirSync(cacheDir, { recursive: true });
  const now = new Date().toISOString();
  // Fresh on BOTH cadences (live + fixtures) so the hot path spawns no refresher
  // and touches no network — this smoke must pass on an offline runner.
  writeFileSync(
    join(cacheDir, 'state.json'),
    JSON.stringify({
      updatedAt: now,
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      live: [
        {
          id: 'smoke1',
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
    }),
  );

  const env = { ...process.env, XDG_CACHE_HOME: dir, CLAUDINHO_FLAGS: 'on' };
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
} finally {
  rmSync(dir, { recursive: true, force: true });
}
