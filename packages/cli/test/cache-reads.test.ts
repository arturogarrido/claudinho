/**
 * 0.11 PR 2.6a, found in review: ONE reader for the files the CLI keeps.
 *
 * A file read by path can be anything by the time it is read: a pipe (the read
 * waits for ever), a file far larger than a check allowed. `readSmallFile`
 * (`src/paths.ts`) reads through one descriptor, without waiting, and bounded.
 * When the snapshot and the note had it and the lock, the market cache and the
 * run counter did not, the same hazard had been fixed in two files and left
 * in three: so the rule is pinned by vocabulary. A module that reads a file
 * by path is named here, with its reason. (The reader moved into core in
 * 0.11 2.5b, so the MCP server reads the user's config file through it too.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

/** Who may call `readFileSync`, and why it is not a file the CLI keeps. */
const BY_PATH: Record<string, string> = {
  'install.ts': 'the user’s own settings file, read by `init` (an interactive command, never the hot path)',
  'cursorPayload.ts': 'standard input (descriptor 0), behind its own guard against a pipe with no writer',
};

/** A file's code: its lines that are not comments. */
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');

describe('the files the CLI keeps are read by one reader', () => {
  it('no module reads a file by path, but the ones named with a reason', () => {
    const readers: string[] = [];
    for (const entry of readdirSync(SRC, { recursive: true })) {
      const file = String(entry);
      if (!file.endsWith('.ts')) continue;
      if (/\breadFileSync\s*\(/.test(code(join(SRC, file)))) readers.push(basename(file));
    }
    expect(readers.sort()).toEqual(Object.keys(BY_PATH).sort());
  });

  it('the reader itself opens once and never by name again', () => {
    // The reader lives in core since 0.11 2.5b (the MCP server reads the
    // config file through it too); the CLI's kept files reach it through
    // `paths.ts`, which re-exports it and holds no reader of its own.
    const reader = code(join(SRC, '..', '..', 'core', 'src', 'files.ts'));
    expect(reader).toMatch(/export function readSmallFile\(/);
    const paths = code(join(SRC, 'paths.ts'));
    expect(paths).toMatch(/export \{ lookAtSmallFile, readSmallFile, type SmallFile \} from '@claudinho\/core';/);
    expect(paths).not.toMatch(/\b(openSync|readSync)\s*\(\s*[^,)]*,\s*['"]?r/);
    // The config file goes through core's no-follow form of it, read at the edge.
    expect(code(join(SRC, 'config.ts'))).toMatch(/\breadUserConfig\(/);
    // The cache, the market cache and the run counter go through it.
    for (const file of ['cache.ts', 'marketCache.ts', 'starNudge.ts']) {
      expect(code(join(SRC, file)), file).toMatch(/\breadSmallFile\(/);
    }
  });

  it('the attempt record is read through it, bounded like the note (0.11, ledger row D8)', () => {
    const cache = code(join(SRC, 'cache.ts'));
    const start = cache.indexOf('export function readAttemptRecord(');
    expect(start).toBeGreaterThan(-1);
    const reader = cache.slice(start, cache.indexOf('\n}\n', start));
    expect(reader).toMatch(/\breadSmallFile\(attemptRecordPath\(source, competition\), MAX_ATTEMPT_BYTES\)/);
    expect(cache).toMatch(/const MAX_ATTEMPT_BYTES = MAX_NOTE_BYTES;/);
  });
});
