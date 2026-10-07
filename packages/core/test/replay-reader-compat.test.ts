/**
 * One reader of the replay format. The repository's private parity harness (a maintainer's tool, outside the
 * tracked tree) replays its corpus through `scripts/replay-preload.mjs` instead of a reader of its own, so the
 * two cannot drift: this test runs the same three requests (a recorded URL, an unrecorded one, a corrupt
 * recording) through the tracked reader and through the private preload, with and without the synthetic flag,
 * and compares what each served and what each logged. The private preload's location comes from the
 * environment, `VERIFY_PRIVATE_REPLAY_READER` (an absolute path); unset, as in CI, the test is skipped with its
 * reason in its name.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const TRACKED = join(ROOT, 'scripts/replay-preload.mjs');
const PRIVATE = process.env.VERIFY_PRIVATE_REPLAY_READER;
const key = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24);
const URLS = ['https://example.invalid/recorded', 'https://example.invalid/unrecorded', 'https://example.invalid/corrupt'];
const PROBE = `const out = [];
for (const url of JSON.parse(process.env.PROBE_URLS)) {
  try { const r = await fetch(url); out.push([url, r.status, await r.text()]); } catch (e) { out.push([url, 'reject', e.constructor.name]); }
}
console.log(JSON.stringify(out));`;

function probe(reader: string, env: Record<string, string>): { served: unknown; logged: unknown[]; stderr: string } {
  const log = join(mkdtempSync(join(tmpdir(), 'compat-')), 'fetches.log');
  writeFileSync(log, '');
  const r = spawnSync(process.execPath, ['--import', reader, '--input-type=module', '-e', PROBE], {
    env: { PATH: process.env.PATH ?? '', PROBE_URLS: JSON.stringify(URLS), VERIFY_FETCH_LOG: log, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  let served: unknown = null;
  try { served = JSON.parse(String(r.stdout)); } catch { served = `no JSON: ${r.stdout}`; }
  const logged = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown);
  return { served, logged, stderr: String(r.stderr) };
}

describe('one reader of the replay format', () => {
  const reason = PRIVATE ? '' : ' (skipped: VERIFY_PRIVATE_REPLAY_READER names no private preload)';
  it.skipIf(!PRIVATE)(`the private parity preload serves and logs exactly as the tracked reader does${reason}`, () => {
    const corpus = mkdtempSync(join(tmpdir(), 'compat-corpus-'));
    writeFileSync(join(corpus, `${key(URLS[0] as string)}.json`), JSON.stringify({ url: URLS[0], status: 200, body: '{"events":[]}' }));
    writeFileSync(join(corpus, `${key(URLS[2] as string)}.json`), JSON.stringify({ url: URLS[2], status: 200, body: { events: [] } }));
    mkdirSync(join(corpus, 'synthetic'));
    writeFileSync(join(corpus, 'synthetic', `${key(URLS[0] as string)}.json`), JSON.stringify({ url: URLS[0], status: 200, body: '{"events":[],"synthetic":true}' }));
    for (const synthetic of ['', '1']) {
      const flag: Record<string, string> = synthetic ? { PARITY_SYNTHETIC: '1' } : {};
      const tracked = probe(TRACKED, { VERIFY_REPLAY_CORPUS: corpus, ...flag });
      const priv = probe(PRIVATE as string, { PARITY_DIR: corpus, PARITY_MODE: 'replay', PARITY_READER: TRACKED, ...flag });
      expect(priv.served, priv.stderr).toEqual(tracked.served);
      expect(priv.logged).toEqual(tracked.logged);
      expect((tracked.logged as Array<{ outcome: string }>).map((e) => e.outcome)).toEqual([synthetic ? 'replayed:synthetic' : 'replayed:raw', 'miss', 'malformed']);
      expect((tracked.served as unknown[][])[0]?.[2]).toBe(synthetic ? '{"events":[],"synthetic":true}' : '{"events":[]}');
    }
  });
});
