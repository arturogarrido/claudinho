import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../src';
import { LANGS, t } from '../src/i18n';

/**
 * 0.15.0 removed the share cards. Core exports no card builder and no share
 * formatter, keeps no folder for them, and keeps no message only they printed.
 * The hashtag the CLI's sign-off prints stays, under a name of its own.
 */
describe('core holds no share code', () => {
  it('no exported name is about sharing, a snippet or a card', () => {
    const names = Object.keys(core);
    expect(names.length).toBeGreaterThan(200);
    expect(names.filter((n) => /share|snippet|card/i.test(n))).toEqual([]);
    // Dead with the cards: the compact bracket line and the earlier-record note were theirs alone.
    expect(names).not.toContain('formatBracketCompactLine');
    expect(names).not.toContain('EARLIER_RECORD_NOTE');
  });

  it('the hashtag is one constant, named for what it is', () => {
    expect((core as Record<string, unknown>).HASHTAG).toBe('#VibingLaVidaLoca');
  });

  it('the share folder is gone', () => {
    expect(existsSync(fileURLToPath(new URL('../src/share', import.meta.url)))).toBe(false);
  });

  it('no locale keeps a message only the cards printed', () => {
    for (const lang of LANGS) {
      // An unknown key is echoed.
      for (const key of ['share.tryIt', 'bracket.shareTitle', 'bracket.empty']) expect(t(lang, key), `${lang} ${key}`).toBe(key);
    }
  });
});
