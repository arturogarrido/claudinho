import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Keep unit tests hermetic. In production the Polymarket adapter derives an
// event slug per fixture and fetches the live API; in tests we route the
// *default* market provider to a network-free no-op so tool tests never touch
// the network. Tests that exercise market behavior inject their own provider.
process.env.CLAUDINHO_MARKETS_SOURCE = 'none';

// No test reads the developer's real config file (a `claudinho follow` they ran
// would change every answer). Each file's tests start where a user who FOLLOWS
// THE WORLD CUP is: a saved choice (the text's first line names no source),
// what the suites written before 0.11 2.5b assumed of a default that no longer
// exists. A test of the first run, or of another saved choice, sets
// XDG_CONFIG_HOME itself and restores it afterwards.
const testConfig = mkdtempSync(join(tmpdir(), 'claudinho-mcp-test-config-'));
mkdirSync(join(testConfig, 'claudinho'), { recursive: true });
writeFileSync(join(testConfig, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition: 'world-cup' }));
process.env.XDG_CONFIG_HOME = testConfig;
afterAll(() => rmSync(testConfig, { recursive: true, force: true }));
