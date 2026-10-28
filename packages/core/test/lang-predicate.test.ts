/**
 * ONE predicate for "is this one of the product's four languages", exported by core: the CLI's `--lang` and
 * `CLAUDINHO_LANG` (`packages/cli/src/config.ts`) and the MCP server's `CLAUDINHO_LANG` ask it, so the variable
 * means the same thing to both. Exact and case-sensitive, nothing trimmed or cut (unlike `normalizeLang`, which
 * reads a `lang` argument leniently and stays as it is).
 */
import { describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { isLang, LANGS, normalizeLang } from '../src/i18n';

describe('isLang', () => {
  it('the four, in order, exported from the package', () => {
    expect(LANGS).toEqual(['en', 'es', 'pt', 'fr']);
    expect(core.LANGS).toBe(LANGS);
    expect(core.isLang).toBe(isLang);
  });

  it('accepts exactly the four codes', () => {
    for (const lang of LANGS) expect(isLang(lang), lang).toBe(true);
  });

  it('refuses every other value: another language, another case, a region, a locale, spaces, empty, absent', () => {
    for (const value of ['de', 'ES', 'Es', 'es-MX', 'es_MX', 'es_MX.UTF-8', ' es', 'es ', '', 'english', undefined, null, 1]) {
      expect(isLang(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('normalizeLang is unchanged: still lenient for a lang argument', () => {
    expect(normalizeLang('ES')).toBe('es');
    expect(normalizeLang('es-MX')).toBe('es');
    expect(normalizeLang('de')).toBe('en');
  });
});
