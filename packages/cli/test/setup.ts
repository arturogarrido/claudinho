// Keep unit tests hermetic. In production the Polymarket adapter derives an
// event slug per fixture and fetches the live API; in tests we route the
// *default* market provider to a network-free no-op so command tests never
// touch the network. Tests that exercise market behavior inject their own
// provider (which takes precedence over this env).
process.env.CLAUDINHO_MARKETS_SOURCE = 'none';

// No test reads or writes the developer's real cache directory. Most CLI test
// files set their own; the ones that do not used to fall through to
// `~/.cache/claudinho`, and a command test there would read a real snapshot
// and, since the throttle note, a real `backoff.json`. A file that sets
// `XDG_CACHE_HOME` itself overrides this and restores it afterwards.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testCache = mkdtempSync(join(tmpdir(), 'claudinho-test-cache-'));
process.env.XDG_CACHE_HOME = testCache;
process.on('exit', () => rmSync(testCache, { recursive: true, force: true }));
