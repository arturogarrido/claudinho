/**
 * The width corpus the plugin's pane is measured against (packages/plugin/hooks/width-corpus.ts): every string's
 * listed width is core's `displayWidth`, the rule the CLI aligns its rows with. The plugin's kit test asserts the pane
 * measures the same strings the same, so a drift of either copy of the rule is a red test on one side.
 *
 * The corpus is loaded by a computed path: it lives outside this package's `rootDir`, which a static import would
 * pull into `tsc`'s program.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { displayWidth } from '../src/text';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const CORPUS_PATH = join(ROOT, 'packages/plugin/hooks/width-corpus.ts');

type WidthCase = { what: string; text: string; width: number };
const load = async (): Promise<WidthCase[]> => {
  const mod = (await import(pathToFileURL(CORPUS_PATH).href)) as { WIDTH_CORPUS?: unknown };
  return mod.WIDTH_CORPUS as WidthCase[];
};

describe('the width corpus', () => {
  it('is the plugin\'s data module, a non-empty list of { what, text, width }', async () => {
    expect(existsSync(CORPUS_PATH)).toBe(true);
    const corpus = await load();
    expect(Array.isArray(corpus)).toBe(true);
    expect(corpus.length).toBeGreaterThan(0);
    for (const c of corpus) {
      expect(typeof c.what).toBe('string');
      expect(typeof c.text).toBe('string');
      expect(Number.isInteger(c.width)).toBe(true);
    }
  });

  it('every listed width is core\'s displayWidth', async () => {
    for (const c of await load()) expect({ what: c.what, width: displayWidth(c.text) }).toEqual({ what: c.what, width: c.width });
  });

  it('covers the classes core measures apart: both flag encodings, U+FE0F, a ZWJ sequence, a keycap, a combining mark, East Asian wide, a format character, the markers', async () => {
    const texts = (await load()).map((c) => c.text);
    const has = (re: RegExp) => texts.some((t) => re.test(t));
    expect(has(/\p{Regional_Indicator}/u)).toBe(true);
    expect(has(/\u{1F3F4}[\u{E0020}-\u{E007F}]/u)).toBe(true);
    expect(has(/️/u)).toBe(true);
    expect(has(/‍/u)).toBe(true);
    expect(has(/⃣/u)).toBe(true);
    expect(has(/\p{Mn}/u)).toBe(true);
    expect(has(/[぀-ヿ一-鿿가-힣]/u)).toBe(true);
    expect(has(/​/u)).toBe(true);
    for (const marker of ['⚽', '\u{1F7E8}', '\u{1F7E5}', '\u{1F504}']) expect(texts).toContain(marker);
  });
});
