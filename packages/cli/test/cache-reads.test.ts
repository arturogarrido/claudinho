/**
 * 0.11 PR 2.6a, found in review: ONE reader for the files the CLI keeps.
 *
 * A file read by path can be anything by the time it is read: a pipe (the read
 * waits for ever), a file far larger than a check allowed. `readSmallFile`
 * (`src/paths.ts`) reads through one descriptor, without waiting, and bounded.
 * When the snapshot and the note had it and the lock, the market cache and the
 * run counter did not, the same hazard had been fixed in two files and left
 * in three: so the rule is pinned by vocabulary. A module that reads a file
 * by path is named here, with its reason.
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
    const paths = code(join(SRC, 'paths.ts'));
    expect(paths).toMatch(/export function readSmallFile\(/);
    // The cache, the market cache and the run counter go through it.
    for (const file of ['cache.ts', 'marketCache.ts', 'starNudge.ts']) {
      expect(code(join(SRC, file)), file).toMatch(/\breadSmallFile\(/);
    }
  });
});
