/**
 * The CI statusline smoke (`scripts/smoke-statusline.mjs`) seeds a cache file by
 * hand and runs the BUILT binary against it, so it has to write the cache
 * format that binary reads. It carried a "bump together" comment next to a
 * literal; when the format went from 2 to 3 the comment was not enough, and the
 * smoke failed on three CI legs (the seeded match read as an empty cache).
 * This pins the literal to the real constant.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CACHE_VERSION } from '../src/cache';

describe('scripts/smoke-statusline.mjs', () => {
  it('seeds the cache format the binary reads', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../scripts/smoke-statusline.mjs', import.meta.url)),
      'utf8',
    );
    const versions = [...src.matchAll(/^\s*version:\s*(\d+)\s*,/gm)].map((m) => Number(m[1]));
    expect(versions).toEqual([CACHE_VERSION]);
  });
});
