/**
 * Generate the bundled static schedule from the ESPN feed:
 *
 *   pnpm -F @claudinho/core gen:schedule
 *
 * The run itself is `buildSchedule` (scripts/build-schedule.ts), which takes
 * its adapter and its writer so it can be tested without the network; this
 * wrapper gives it the real ones, prints a refusal, and exits 1 on it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EspnAdapter } from '../src/adapters/espn';
import { BUNDLE_COMPETITION } from '../src/competition';
import { buildSchedule } from './build-schedule';

/** The core package's root: where the relative paths `buildSchedule` writes to are resolved. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

buildSchedule({
  adapter: new EspnAdapter({ competition: BUNDLE_COMPETITION }),
  write: (path, body) => writeFileSync(join(root, path), body),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}).catch((err: unknown) => {
  console.error(`\ngen:schedule refused: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
