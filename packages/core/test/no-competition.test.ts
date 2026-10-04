/**
 * `noCompetition` is the sixth replacing verdict (0.11 · 2.5b, D1), first in
 * order: a result stating it is answered by the one sentence whatever else it
 * states, its key reaches the structured output through `verdictExtras`, and
 * the guides say the choice is the user's (no "World Cup by default" is left
 * in the public READMEs, the privacy note names the config file, and the
 * cache's path functions take a competition always: the unsuffixed default
 * that assumed one is gone).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { t, verdictExtras, verdictNotice, verdictQualifiers } from '../src';

const at = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const code = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');

describe('the verdict', () => {
  it('replaces the body, ahead of every other replacing verdict, in four locales', () => {
    const r = { noCompetition: true as const, unsupported: true as const, inapplicable: true as const, partial: {} };
    expect(verdictNotice(r, 'en')).toBe(t('en', 'competition.none'));
    expect(verdictNotice(r, 'en')).toMatch(/No competition chosen/);
    expect(verdictNotice(r, 'es')).toMatch(/Ninguna competición/);
    expect(verdictNotice(r, 'pt')).toMatch(/Nenhuma competição/);
    expect(verdictNotice(r, 'fr')).toMatch(/Aucune compétition/);
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      expect(verdictNotice(r, lang), lang).toMatch(/claudinho follow/);
      expect(verdictNotice(r, lang), lang).toMatch(/list_competitions/);
    }
    // A replacing verdict: the qualifiers are not printed beside it.
    expect(verdictQualifiers(r, 'en')).toEqual([]);
  });

  it('reaches the structured output as its own key', () => {
    expect(verdictExtras({ noCompetition: true })).toEqual({ noCompetition: true });
    expect(verdictExtras({})).toEqual({});
  });
});

describe('the guides and the cache paths', () => {
  it('no public README says the World Cup is the default; each names `claudinho follow`', () => {
    for (const rel of ['../../../README.md', '../../cli/README.md', '../../mcp/README.md']) {
      const text = at(rel);
      expect(text, rel).not.toMatch(/World Cup is the default|else the 2026 World Cup|default: the 2026 World Cup/);
      expect(text, rel).toMatch(/claudinho follow/);
    }
  });

  it('the privacy note names the config file, written only by `follow`, read locally; the MCP server reads it and writes none', () => {
    const text = at('../../../PRIVACY.md');
    expect(text).toMatch(/config\.json/);
    expect(text).toMatch(/claudinho follow/);
    expect(text).toMatch(/reads/);
    expect(text).not.toMatch(/writes \*\*no cache files to disk\*\*\.\s*$/m);
  });

  it('the cache path functions take a competition: no default argument assumes one', () => {
    const cache = code(at('../../cli/src/cache.ts'));
    expect(cache).not.toMatch(/competition\s*=\s*DEFAULT_COMPETITION/);
    expect(cache).not.toMatch(/competition\s*=\s*['"]fifa\.world['"]/);
  });
});
