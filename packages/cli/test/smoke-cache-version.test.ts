/**
 * The scripts that seed a statusline cache by hand and run the BUILT binary
 * against it (the CI smoke, `scripts/smoke-statusline.mjs`, and since 0.11 · 2.7
 * the release QA's club render) write it through ONE helper,
 * `scripts/statusline-seed.mjs`, so it has to write the cache format and the
 * file name that binary reads. The smoke once carried a "bump together"
 * comment next to a literal; when the format went from 2 to 3 the comment was
 * not enough, and the smoke failed on three CI legs (the seeded match read as an
 * empty cache). This pins the helper's literal to the real constant, its file
 * name to the real path rule, and the two scripts to the helper.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CACHE_VERSION, cachePath } from '../src/cache';

const script = (name: string) => fileURLToPath(new URL(`../../../scripts/${name}`, import.meta.url));
const VERSION_LITERAL = /^\s*version:\s*(\d+)\s*,/gm;

describe('scripts/statusline-seed.mjs', () => {
  it('seeds the cache format the binary reads', () => {
    const src = readFileSync(script('statusline-seed.mjs'), 'utf8');
    const versions = [...src.matchAll(VERSION_LITERAL)].map((m) => Number(m[1]));
    expect(versions).toEqual([CACHE_VERSION]);
  });

  it('names the snapshot as the binary does, for the bundled scope and any other', async () => {
    const { stateFileName } = (await import(script('statusline-seed.mjs'))) as {
      stateFileName: (source: string, competition: string) => string;
    };
    for (const [source, competition] of [
      ['espn', 'fifa.world'],
      ['espn', 'eng.1'],
      ['espn', 'esp.copa_del_rey'],
      ['other', 'a/b c'],
    ] as const) {
      expect(stateFileName(source, competition), `${source} ${competition}`).toBe(basename(cachePath(source, competition)));
    }
  });

  it('the smoke and the release QA seed through it, and neither spells the format', () => {
    const smoke = readFileSync(script('smoke-statusline.mjs'), 'utf8');
    expect(smoke).toMatch(/from '\.\/statusline-seed\.mjs'/);
    expect(smoke).toContain('seedState(');
    expect([...smoke.matchAll(VERSION_LITERAL)]).toEqual([]);
    const qa = readFileSync(script('release-qa.sh'), 'utf8');
    expect(qa).toContain('scripts/statusline-seed.mjs');
    expect([...qa.matchAll(VERSION_LITERAL)]).toEqual([]);
  });
});
