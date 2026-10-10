#!/usr/bin/env node
/**
 * The ONE way a script seeds the statusline's micro-cache (0.11 · 2.7). The CI
 * smoke (`scripts/smoke-statusline.mjs`) and the release QA's club render
 * (`scripts/release-qa.sh`) both write their snapshot through `seedState`, so
 * the cache format a script writes is written down once, here. Its format
 * version and its file name are copies of the CLI's (`CACHE_VERSION` and
 * `cachePath` in packages/cli/src/cache.ts), pinned to them by
 * packages/cli/test/smoke-cache-version.test.ts: a "bump together" comment
 * alone did not survive the 0.11 format change.
 *
 * Every seed is stamped `now`, so the live slice is fresh and the hot path's
 * trigger (`refreshWanted`) does not start a refresher: a seeded `prompt`
 * touches no network and leaves no detached process behind.
 *
 * The command line the release QA calls:
 *   node scripts/statusline-seed.mjs club <cache-home> <slug>
 * seeds a live club match (Arsenal 2–1 Chelsea, 50') for <slug> under
 * <cache-home>/claudinho, with a schedule slice discovered `now`, and prints
 * the file it wrote.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The bundled competition's scope keeps the bare `state.json`; any other is named by its source and competition. */
export function stateFileName(source, competition) {
  if (source === 'espn' && competition === 'fifa.world') return 'state.json';
  return `state.${`${source}.${competition}`.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

/**
 * Writes a snapshot for one scope under `<cacheHome>/claudinho` (the directory
 * the CLI reads with XDG_CACHE_HOME=<cacheHome>) and returns its path.
 */
export function seedState(cacheHome, { source = 'espn', competition, now = new Date().toISOString(), live = [], ...rest }) {
  const dir = join(cacheHome, 'claudinho');
  mkdirSync(dir, { recursive: true });
  const state = {
    version: 5,
    updatedAt: now,
    degraded: false,
    source,
    competition,
    live,
    ...rest,
  };
  const path = join(dir, stateFileName(source, competition));
  writeFileSync(path, JSON.stringify(state));
  return path;
}

/** What the statusline prints for the seeded club match: its codes (a club has no flag) and its score. */
export const SEEDED_CLUB_MATCH = 'ARS 2–1 CHE';

/**
 * A live club match, as the refresher would have cached it a moment ago: the
 * provider's team ids, no flags (a club has none), the league's written stage,
 * a live read that was whole (`liveComplete`), and the schedule slice
 * discovered `now` (so discovery is not due either).
 */
export function seedClub(cacheHome, competition, now = new Date()) {
  const at = now.toISOString();
  const kickoff = new Date(now.getTime() - 50 * 60_000).toISOString();
  return seedState(cacheHome, {
    competition,
    now: at,
    live: [
      {
        id: '900002',
        stage: 'REGULAR',
        kickoff,
        venue: 'Emirates Stadium',
        home: { id: 'espn:359', code: 'ARS', name: 'Arsenal' },
        away: { id: 'espn:363', code: 'CHE', name: 'Chelsea' },
        status: 'LIVE',
        minute: 50,
        score: { home: 2, away: 1 },
        updatedAt: at,
      },
    ],
    liveComplete: true,
    schedule: { updatedAt: at, attemptedAt: at, failures: 0, complete: true },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, cacheHome, slug] = process.argv.slice(2);
  if (kind !== 'club' || !cacheHome || !slug) {
    process.stderr.write('usage: statusline-seed.mjs club <cache-home> <slug>\n');
    process.exit(2);
  }
  process.stdout.write(seedClub(cacheHome, slug));
}
