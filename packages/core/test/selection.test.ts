/**
 * The selection, resolved once at the edge from three sources, by alias or
 * slug (0.11 · 2.5a, D2). Core reads no environment: the edge hands the three
 * values in. An alias resolves to its row's slug; a slug in the table to
 * itself; a raw slug written nowhere is experimental; anything else is
 * refused with the alias list, never a request. In 2.5a, with nothing chosen,
 * the bundle is the default (`chosenBy: 'default'`, a value that exists only
 * until 2.5b); `none` is reserved for the absent slug.
 */
import { describe, expect, it } from 'vitest';
import { modeLine, resolveCompetition, selectionExtras } from '../src';

describe('resolveCompetition(explicit, env, saved)', () => {
  it('an alias or a slug, from the flag', () => {
    expect(resolveCompetition('premier-league')).toEqual({ kind: 'selected', slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag', experimental: false });
    expect(resolveCompetition('eng.1')).toMatchObject({ kind: 'selected', slug: 'eng.1', alias: 'premier-league', chosenBy: 'flag' });
    expect(resolveCompetition('world-cup')).toMatchObject({ slug: 'fifa.world', name: 'World Cup', chosenBy: 'flag' });
  });

  it('the precedence: the flag, then the environment, then the saved choice, then the default', () => {
    expect(resolveCompetition('premier-league', 'esp.1', 'ita.1')).toMatchObject({ slug: 'eng.1', chosenBy: 'flag' });
    expect(resolveCompetition(undefined, 'esp.1', 'ita.1')).toMatchObject({ slug: 'esp.1', chosenBy: 'env' });
    expect(resolveCompetition(undefined, undefined, 'serie-a')).toMatchObject({ slug: 'ita.1', chosenBy: 'saved' });
    expect(resolveCompetition()).toMatchObject({ kind: 'selected', slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'default', experimental: false });
    expect(resolveCompetition('', '', '')).toMatchObject({ slug: 'fifa.world', chosenBy: 'default' });
  });

  it('a raw slug written nowhere is experimental, with the slug as its name and no alias', () => {
    const r = resolveCompetition('fifa.friendly');
    expect(r).toEqual({ kind: 'selected', slug: 'fifa.friendly', name: 'fifa.friendly', chosenBy: 'flag', experimental: true });
    expect(resolveCompetition(undefined, 'usa.1')).toMatchObject({ slug: 'usa.1', chosenBy: 'env', experimental: true });
    expect(resolveCompetition('a1.b2.c3')).toMatchObject({ experimental: true });
    // Real slugs carry underscores (measured Oct 4: `esp.copa_del_rey`, `eng.league_cup`, `ger.dfb_pokal` answer 200).
    expect(resolveCompetition('esp.copa_del_rey')).toMatchObject({ kind: 'selected', slug: 'esp.copa_del_rey', experimental: true });
    expect(resolveCompetition(undefined, 'eng.league_cup')).toMatchObject({ kind: 'selected', experimental: true });
    expect(resolveCompetition('esp._').kind).toBe('selected');
    // The bound: 64 units is a slug, 65 is not (a dotted one, so the grammar alone does not refuse it).
    expect(resolveCompetition(`${'a'.repeat(59)}.bcde`).kind).toBe('selected');
  });

  it('anything else is refused with the aliases, never a request', () => {
    for (const bad of ['foo', 'ENG.1', 'eng.1 ', 'a b', 'premier league', '.eng', 'eng.', 'eng..1', 'x'.repeat(65), `${'a'.repeat(60)}.bcde`, 'constructor', 'é.1']) {
      const r = resolveCompetition(bad);
      expect(r.kind, bad).toBe('refused');
      if (r.kind === 'refused') {
        expect(r.value).toBe(bad);
        expect(r.aliases).toContain('premier-league');
        expect(r.aliases).toHaveLength(15);
      }
    }
  });

  it('a refused environment value under a saved choice: the environment is still what was asked (refused), not the saved one', () => {
    expect(resolveCompetition(undefined, 'foo', 'eng.1').kind).toBe('refused');
  });
});

describe('what a surface says about the selection', () => {
  const sel = (over: Record<string, unknown>) => ({ kind: 'selected' as const, slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' as const, experimental: false, ...over });

  it('the mode line: the name, then the source when it was the flag or the environment, then experimental', () => {
    expect(modeLine(sel({}), 'en')).toBe('Premier League · from the command line');
    expect(modeLine(sel({ chosenBy: 'env' }), 'en')).toBe('Premier League · from the environment');
    expect(modeLine(sel({ chosenBy: 'saved' }), 'en')).toBe('Premier League');
    expect(modeLine(sel({ chosenBy: 'default', slug: 'fifa.world', alias: 'world-cup', name: 'World Cup' }), 'en')).toBe('World Cup');
    expect(modeLine(sel({ slug: 'fifa.friendly', alias: undefined, name: 'fifa.friendly', experimental: true }), 'en')).toBe('fifa.friendly · from the command line · experimental');
    expect(modeLine(sel({ slug: 'fifa.friendly', alias: undefined, name: 'fifa.friendly', experimental: true, chosenBy: 'saved' }), 'en')).toBe('fifa.friendly · experimental');
  });

  it('the suffixes are localized; the name is not', () => {
    expect(modeLine(sel({}), 'es')).toBe('Premier League · desde la línea de comandos');
    expect(modeLine(sel({ chosenBy: 'env' }), 'pt')).toBe('Premier League · do ambiente');
    expect(modeLine(sel({ chosenBy: 'env' }), 'fr')).toBe("Premier League · depuis l'environnement");
    expect(modeLine(sel({ slug: 'fifa.friendly', alias: undefined, name: 'fifa.friendly', experimental: true, chosenBy: 'saved' }), 'es')).toBe('fifa.friendly · experimental');
    expect(modeLine(sel({ chosenBy: 'env' }), 'xx')).toBe('Premier League · from the environment');
  });

  it('the structured key: one object, the alias and the experimental mark only when they apply', () => {
    expect(selectionExtras(sel({}))).toEqual({ competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' } });
    expect(selectionExtras(sel({ slug: 'fifa.friendly', alias: undefined, name: 'fifa.friendly', experimental: true, chosenBy: 'env' }))).toEqual({ competition: { slug: 'fifa.friendly', name: 'fifa.friendly', chosenBy: 'env', experimental: true } });
  });
});
