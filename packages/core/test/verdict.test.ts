/**
 * 0.11 PR 2.0b — one place where a verdict becomes output.
 *
 * A "verdict" is something a result says about ITSELF that changes what a
 * reader may conclude: "this is not available for this competition" is not "no
 * fixture found". Twice in 0.10.1 a surface printed a verdict in its text and
 * dropped it from the structured twin (a card's `--json` lost `partial`,
 * `markets --json` lost `unsupported`), and the MCP tools still drop
 * `unsupported` from `data` today. Each time the cause was the same: every
 * surface forwarded each verdict by hand.
 *
 * `verdictExtras` (the structured keys) and `verdictNotice` (the localized
 * sentence) are the two functions every surface now calls, so a verdict added
 * here reaches all of them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARKETS_SCOPE_NOTE } from '../src/markets/format';
import { marketDisplayable } from '../src/markets/normalize';
import { marketScopeVerdict } from '../src/markets/provider';
import { tableData } from '../src/standings';
import { verdictExtras, verdictNotice, verdictQualifiers } from '../src/verdict';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('verdictExtras — the structured keys, from one place', () => {
  it('carries a verdict a result states, and nothing when it states none', () => {
    expect(verdictExtras({ unsupported: true })).toEqual({ unsupported: true });
    expect(verdictExtras({})).toEqual({});
    expect(verdictExtras({ unsupported: undefined })).toEqual({});
  });

  it('takes only verdicts: the rest of a result is not its business', () => {
    const result = { fixture: undefined, degraded: false, source: 'espn', unsupported: true as const };
    expect(verdictExtras(result)).toEqual({ unsupported: true });
    const healthy: { degraded: boolean; source: string; unsupported?: boolean } = { degraded: true, source: 'espn' };
    expect(Object.keys(verdictExtras(healthy))).toEqual([]);
  });
});

describe('marketScopeVerdict — what a market read says about its competition before any request', () => {
  it('states the verdict outside the sidecar’s scope, and nothing inside it', () => {
    expect(marketScopeVerdict('fifa.world', 0)).toEqual({});
    expect(marketScopeVerdict('eng.1', 0)).toEqual({ unsupported: true });
    expect(verdictExtras(marketScopeVerdict('uefa.nations', 0))).toEqual({ unsupported: true });
    // A read that shows signals states no such verdict (the demo source reads any competition).
    expect(marketScopeVerdict('eng.1', 2)).toEqual({});
    expect(marketScopeVerdict('fifa.world', 2)).toEqual({});
  });
});

describe('verdictNotice — the sentence, in the reader’s language', () => {
  it('is the same localized sentence for every surface', () => {
    expect(verdictNotice({ unsupported: true }, 'en')).toBe('Not available for this competition yet.');
    expect(verdictNotice({ unsupported: true }, 'es')).toBe('Aún no disponible para esta competición.');
    expect(verdictNotice({ unsupported: true }, 'pt')).toBe('Ainda não disponível para esta competição.');
    expect(verdictNotice({ unsupported: true }, 'fr')).toBe('Pas encore disponible pour cette compétition.');
  });

  it('is absent when the result states no verdict', () => {
    expect(verdictNotice({}, 'en')).toBeUndefined();
    const outage: { degraded: boolean; unsupported?: boolean } = { degraded: true };
    expect(verdictNotice(outage, 'en')).toBeUndefined();
  });
});

describe('a verdict REPLACES the body or QUALIFIES it, and the module says which (0.11 2.1b)', () => {
  // Found in the plan gate: `cmdBracket` and `toolGetBracket` treated ANY
  // sentence as the whole answer, and `next` printed one only on an empty
  // body. A qualifying verdict sent through the one function would have
  // hidden a readable tree, or vanished beside a populated answer.
  it('`unsupported` replaces; `incomplete` and `partial` qualify, in a fixed order', () => {
    expect(verdictNotice({ unsupported: true }, 'en')).toBe('Not available for this competition yet.');
    expect(verdictQualifiers({ unsupported: true }, 'en')).toEqual([]);
    // A stated replacement stands for the whole answer: its qualifiers are not printed.
    expect(verdictQualifiers({ unsupported: true, partial: { omitted: 1 }, incomplete: true }, 'en')).toEqual([]);
    expect(verdictNotice({ partial: { omitted: 2 } }, 'en')).toBeUndefined();
    expect(verdictQualifiers({ partial: { omitted: 2 } }, 'en')).toEqual(['Fixture data may be incomplete (2 provider records omitted).']);
    expect(verdictQualifiers({ partial: { omitted: 1 } }, 'en')).toEqual(['Fixture data may be incomplete (1 provider record omitted).']);
    expect(verdictQualifiers({ partial: {} }, 'en')).toEqual(['Fixture data may be incomplete.']);
    expect(verdictQualifiers({ incomplete: true, partial: { omitted: 1 } }, 'en')).toEqual([
      'Some tables could not be read — this is not the whole competition.',
      'Fixture data may be incomplete (1 provider record omitted).',
    ]);
    expect(verdictQualifiers({}, 'en')).toEqual([]);
    expect(verdictQualifiers({ degraded: true } as { degraded: boolean }, 'en')).toEqual([]);
  });

  it('the partial sentence in every language, counted and not, and the key in the structured output', () => {
    for (const lang of ['es', 'pt', 'fr']) {
      const [counted] = verdictQualifiers({ partial: { omitted: 3 } }, lang);
      const [plain] = verdictQualifiers({ partial: {} }, lang);
      expect(counted, lang).toMatch(/\b3\b/);
      expect(counted, lang).not.toBe('Fixture data may be incomplete (3 provider records omitted).');
      expect(plain, lang).not.toBe('Fixture data may be incomplete.');
      expect(plain, lang).not.toBe(counted);
    }
    expect(verdictExtras({ partial: { omitted: 1 } })).toEqual({ partial: { omitted: 1 } });
    expect(verdictExtras({ partial: {} })).toEqual({ partial: {} });
    expect(verdictExtras({ unsupported: true, partial: { omitted: 1 } })).toEqual({ unsupported: true, partial: { omitted: 1 } });
  });

  it('a count is believed only as a finite positive integer; otherwise the verdict stands without one', () => {
    for (const omitted of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY] as number[]) {
      expect(verdictExtras({ partial: { omitted } }), String(omitted)).toEqual({ partial: {} });
      expect(verdictQualifiers({ partial: { omitted } }, 'en'), String(omitted)).toEqual(['Fixture data may be incomplete.']);
    }
  });
  it('three more replacements (0.11 2.1c): `inapplicable`, `unknownTeam`, `betweenEditions`, in that precedence after `unsupported`; each a sentence and a key', () => {
    expect(verdictNotice({ inapplicable: true }, 'en')).toBe('This competition has no bracket.');
    expect(verdictExtras({ inapplicable: true })).toEqual({ inapplicable: true });
    expect(verdictNotice({ unknownTeam: true }, 'en')).toMatch(/^No team called/);
    // Review round 4: the sentence names its evidence. A table read whole is not the whole competition (a club
    // out in a qualifying round is in no table), so the claim is about the table and the span, not the competition.
    expect(verdictNotice({ unknownTeam: true, query: 'Everton', rosterEvidence: 'table' } as never, 'en')).toBe(
      "No team called Everton in the competition's table or in its fixtures over the next 14 days.",
    );
    // On the World Cup the evidence is the bundled roster of nations, and the sentence says that, not the span.
    const nation = verdictNotice({ unknownTeam: true, query: 'Italy', rosterEvidence: 'bundle' } as never, 'en') ?? '';
    expect(nation).toMatch(/^No team called Italy/);
    expect(nation).toMatch(/nations|World Cup/);
    expect(nation).not.toContain('14 days');
    expect(verdictExtras({ unknownTeam: true, rosterEvidence: 'bundle' } as never)).toEqual({ unknownTeam: true, rosterEvidence: 'bundle' });
    expect(verdictExtras({ unknownTeam: true })).toEqual({ unknownTeam: true });
    // `ended` is the provider's end DAY (the rule decides on it), printed as it is.
    const between = { betweenEditions: { ended: '2026-10-08', label: '2026 Concacaf Champions Cup' } };
    expect(verdictNotice(between, 'en')).toBe('Between editions: the 2026 Concacaf Champions Cup edition ended on 2026-10-08.');
    expect(verdictExtras(between)).toEqual(between);
    // An end that is not a timestamp is not believed: no sentence, no key.
    expect(verdictNotice({ betweenEditions: { ended: 'yesterday' } } as never, 'en')).toBeUndefined();
    expect(verdictExtras({ betweenEditions: { ended: 'yesterday' } } as never)).toEqual({});
    // An empty label names the year of the end date instead.
    expect(verdictNotice({ betweenEditions: { ended: '2026-10-08' } }, 'en')).toBe('Between editions: the 2026 edition ended on 2026-10-08.');
    // A replacement suppresses the qualifiers, as `unsupported` does.
    expect(verdictQualifiers({ ...between, partial: { omitted: 1 } }, 'en')).toEqual([]);
    expect(verdictQualifiers({ inapplicable: true, incomplete: true }, 'en')).toEqual([]);
    // Precedence when a result states more than one: unsupported, inapplicable, unknownTeam, betweenEditions.
    expect(verdictNotice({ unsupported: true, inapplicable: true }, 'en')).toBe('Not available for this competition yet.');
    expect(verdictNotice({ inapplicable: true, unknownTeam: true }, 'en')).toBe('This competition has no bracket.');
    expect(verdictNotice({ unknownTeam: true, ...between }, 'en')).toMatch(/^No team called/);
    // A fifth replacement (review round 2): the roster could not be read whole, so the club could not be resolved.
    expect(verdictNotice({ rosterIncomplete: true, query: 'ARS' } as never, 'en')).toMatch(/roster/i);
    expect(verdictNotice({ rosterIncomplete: true } as never, 'en')).not.toMatch(/reach the data provider/);
    expect(verdictExtras({ rosterIncomplete: true } as never)).toEqual({ rosterIncomplete: true });
    expect(verdictQualifiers({ rosterIncomplete: true, partial: {} } as never, 'en')).toEqual([]);
    expect(verdictNotice({ unknownTeam: true, rosterIncomplete: true } as never, 'en')).toMatch(/^No team called/);
    for (const lang of ['es', 'pt', 'fr']) {
      expect(verdictNotice({ rosterIncomplete: true } as never, lang), lang).not.toMatch(/roster could not/i);
      expect(verdictNotice({ inapplicable: true }, lang), lang).not.toBe('This competition has no bracket.');
      expect(verdictNotice(between, lang), lang).not.toMatch(/^Between editions/);
      expect(verdictNotice(between, lang), lang).toContain('2026 Concacaf Champions Cup');
      expect(verdictNotice({ unknownTeam: true }, lang), lang).not.toMatch(/^No team called/);
      expect(verdictNotice({ unknownTeam: true, query: 'Everton' } as never, lang), lang).toMatch(/14/);
    }
  });
});

describe('tableData — a table’s structured form', () => {
  it('keeps the verdict a partial table carries', () => {
    const whole = { group: 'A', rows: [] };
    const partial = { group: 'B', rows: [], partial: { omitted: 2 } };
    expect(tableData(whole)).toEqual({ group: 'A', standings: [] });
    expect(tableData(partial)).toEqual({ group: 'B', standings: [], partial: { omitted: 2 } });
  });
});

describe('one definition of each rule the two surfaces used to copy', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.ts$/.test(name) ? [path] : [];
    });
  }
  const hits = (pkg: string, pattern: RegExp): string[] =>
    sources(join(PACKAGES, pkg, 'src'))
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(PACKAGES, f).split(sep).join('/'));

  it('whether a market signal may be displayed is decided in core', () => {
    expect(typeof marketDisplayable).toBe('function');
    expect(hits('cli', /function marketDisplayable\b/)).toEqual([]);
    expect(hits('mcp', /function marketDisplayable\b/)).toEqual([]);
  });

  it('no surface forwards a verdict by hand', () => {
    // The pattern that was copied to every emit site, and forgotten at some.
    const byHand = /unsupported\s*\?\s*\{\s*unsupported:\s*true\s*\}/;
    expect(hits('cli', byHand)).toEqual([]);
    expect(hits('mcp', byHand)).toEqual([]);
  });

  it('no surface writes out a table’s structured form, or its `partial` verdict, itself', () => {
    const byHand = /partial\s*\?\s*\{\s*partial\b/;
    expect(hits('cli', byHand)).toEqual([]);
    expect(hits('mcp', byHand)).toEqual([]);
  });

  it('nor the `partial` verdict of a read (0.11 2.1b): the key is declared once, in the MCP schema; the sentence is nowhere', () => {
    expect(codeHits('cli', /\bpartial\s*:/)).toEqual([]);
    expect(codeHits('mcp', /\bpartial\s*:/)).toEqual(['mcp/src/server.ts']);
    expect(hits('cli', /['"`]read\.partial/)).toEqual([]);
    expect(hits('mcp', /['"`]read\.partial/)).toEqual([]);
    expect(hits('cli', /may be incomplete/)).toEqual([]);
    expect(hits('mcp', /may be incomplete/)).toEqual([]);
  });

  it('a surface hands over the RESULT, not the fields it remembers', () => {
    // `verdictExtras({ unsupported })` compiles and works today, and silently
    // drops the next verdict a result learns to state. The functions are given
    // the result itself, never an object built on the spot.
    const rewrapped = /verdict(Extras|Notice|Qualifiers)\(\s*\{/;
    expect(hits('cli', rewrapped)).toEqual([]);
    expect(hits('mcp', rewrapped)).toEqual([]);
  });

  // Found in review: the patterns above name the forms that were actually
  // written, and an equivalent form walks past them
  // (`found.unsupported === true ? { unsupported: true } : {}`). The checks
  // below are about the VOCABULARY instead: a surface has no reason to spell
  // these words at all, so any spelling of the copy is caught.
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const codeHits = (pkg: string, pattern: RegExp): string[] =>
    sources(join(PACKAGES, pkg, 'src'))
      .filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(PACKAGES, f).split(sep).join('/'));

  it('a surface never names a verdict: the only code that says `unsupported` is the schema that declares it', () => {
    expect(codeHits('cli', /\bunsupported\b/)).toEqual([]);
    expect(codeHits('mcp', /\bunsupported\b/)).toEqual(['mcp/src/server.ts']);
  });

  it('nor `incomplete`: a surface never writes that key or that sentence; the schema declares it once', () => {
    // Found in review: the guard knew `unsupported` and `partial` only, so an
    // emit site could have spelled the new verdict by hand unnoticed.
    expect(codeHits('cli', /\bincomplete\s*:/)).toEqual([]);
    expect(codeHits('mcp', /\bincomplete\s*:/)).toEqual(['mcp/src/server.ts']);
    const sentence = /['"`]standings\.incomplete['"`]/;
    expect(hits('cli', sentence)).toEqual([]);
    expect(hits('mcp', sentence)).toEqual([]);
    expect(verdictExtras({ incomplete: true })).toEqual({ incomplete: true });
    expect(verdictQualifiers({ incomplete: true }, 'fr')).toEqual(["Certains classements n'ont pas pu être lus — ce n'est pas la compétition complète."]);
    // A qualifier is printed BESIDE the body, never instead of it: it is not a replacement.
    expect(verdictNotice({ incomplete: true }, 'en')).toBeUndefined();
    // "Not available" replaces the body, so it is the one said when a result states both.
    expect(verdictNotice({ unsupported: true, incomplete: true }, 'en')).toBe('Not available for this competition yet.');
  });

  it('a surface never builds a table’s structured form or re-derives the display rule', () => {
    // The MCP schema declares the read's `partial` verdict (0.11 2.1b); no surface writes the key.
    for (const pkg of ['cli', 'mcp']) expect(codeHits(pkg, /\bpartial\s*:/), pkg).toEqual(pkg === 'mcp' ? ['mcp/src/server.ts'] : []);
    // The display rule's last condition, in the two files that render signals.
    // (The CLI's market cache also checks a distribution, when it READS a
    // cached signal: a different rule, about a different thing.)
    for (const [pkg, file] of [['cli', 'commands.ts'], ['mcp', 'tools.ts']] as const) {
      const code = stripComments(readFileSync(join(PACKAGES, pkg, 'src', file), 'utf8'));
      expect(/\bhasSaneDistribution\b/.test(code), `${pkg}/${file}`).toBe(false);
    }
  });

  it('no surface writes the "not available" sentence itself', () => {
    const sentence = /['"`]competition\.unsupported['"`]/;
    expect(hits('cli', sentence)).toEqual([]);
    expect(hits('mcp', sentence)).toEqual([]);
  });

  it('nor the three verdicts of 0.11 2.1c: the keys are declared once, in the MCP schema; the sentences and their i18n keys nowhere at a surface', () => {
    for (const key of ['inapplicable', 'unknownTeam', 'betweenEditions', 'rosterIncomplete']) {
      const written = new RegExp(`\\b${key}\\s*:`);
      expect(codeHits('cli', written), key).toEqual([]);
      expect(codeHits('mcp', written), key).toEqual(['mcp/src/server.ts']);
    }
    for (const i18nKey of ['competition.noBracket', 'team.unknown', 'edition.between', 'roster.incomplete']) {
      const written = new RegExp(`['"\`]${i18nKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
      expect(hits('cli', written), i18nKey).toEqual([]);
      expect(hits('mcp', written), i18nKey).toEqual([]);
    }
    for (const sentence of [/no bracket/, /No team called/, /Between editions/]) {
      expect(codeHits('cli', sentence), String(sentence)).toEqual([]);
      expect(codeHits('mcp', sentence), String(sentence)).toEqual([]);
    }
    // The horizon and window sentences belong to `bodyText.ts`: a surface never spells them.
    for (const sentence of [/within the next/, /Not found between/]) {
      expect(codeHits('cli', sentence), String(sentence)).toEqual([]);
      expect(codeHits('mcp', sentence), String(sentence)).toEqual([]);
    }
  });

  it('the sentences of 0.11 2.1d come from one place too: "none read" for live and a date, the unserved rows, the market empty body', async () => {
    // Red first: the builders do not exist. They live beside the next and match ones in core's body-text module.
    const cards = await import('../src/bodyText');
    const live = (cards as Record<string, unknown>).liveNoneReadSentence as ((lang?: string) => string) | undefined;
    const date = (cards as Record<string, unknown>).dateNoneReadSentence as ((date: string, lang?: string) => string) | undefined;
    const unserved = (cards as Record<string, unknown>).unservedSentence as ((n: number, lang?: string) => string) | undefined;
    const unreached = (cards as Record<string, unknown>).dateUnreachedSentence as ((date: string, lang?: string) => string) | undefined;
    expect(typeof live).toBe('function');
    expect(typeof date).toBe('function');
    expect(typeof unserved).toBe('function');
    expect(typeof unreached).toBe('function');
    // The outage sentence of a day with no bundled schedule: the date card's, now every date surface's.
    expect(unreached?.('2026-10-10', 'en')).toMatch(/no fixtures confirmed/);
    expect(unreached?.('2026-10-10', 'en')).toContain('2026-10-10');
    expect(unreached?.('2026-10-10', 'es')).not.toBe(unreached?.('2026-10-10', 'en'));
    expect(live?.('en')).toMatch(/read/i);
    expect(live?.('en')).not.toMatch(/No matches in play right now/);
    expect(date?.('2026-10-10', 'en')).toMatch(/read/i);
    expect(date?.('2026-10-10', 'en')).toContain('2026-10-10');
    expect(unserved?.(2, 'en')).toMatch(/2 fixtures? .*bundled schedule/);
    expect(unserved?.(2, 'en')).toMatch(/unconfirmed/);
    for (const lang of ['es', 'pt', 'fr']) {
      expect(live?.(lang), lang).not.toBe(live?.('en'));
      expect(unserved?.(2, lang), lang).toMatch(/2/);
      // The singular is its own string in every language: not the English one, not the language's plural.
      expect(unserved?.(1, lang), lang).toMatch(/1/);
      expect(unserved?.(1, lang), lang).not.toBe(unserved?.(1, 'en'));
      expect(unserved?.(1, lang), lang).not.toBe(unserved?.(2, lang)?.replace('2', '1'));
    }
    // The keys as they EXIST (`today.unserved` is a prefix: the catalog holds `.one` and `.other`), so a surface
    // spelling either real key is caught; a review found the quoted-prefix form matched neither.
    for (const i18nKey of ['live.noneRead', 'today.noneRead', 'today.unserved.one', 'today.unserved.other', 'markets.noneRead', 'today.unreached']) {
      const written = new RegExp(`['"\`]${i18nKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
      expect(hits('cli', written), i18nKey).toEqual([]);
      expect(hits('mcp', written), i18nKey).toEqual([]);
    }
    // The sentences, not the phrase: a tool description may say what "was read" in prose.
    for (const sentence of [/(in play|fixture) was read/, /bundled schedule; (its|their) live state/, /among the fixtures read/, /no fixtures confirmed/]) {
      expect(codeHits('cli', sentence), String(sentence)).toEqual([]);
      expect(codeHits('mcp', sentence), String(sentence)).toEqual([]);
    }
  });

  it('nor `noCompetition` (0.11 2.5b): the key is declared once, in the MCP schema; the sentence and its keys nowhere at a surface', () => {
    // A surface states it through core: `verdictExtras(selectionVerdict(selection))` for the key,
    // `verdictNotice` (MCP) or `selectionRefusal` (CLI) for the sentence.
    expect(codeHits('cli', /\bnoCompetition\s*:/)).toEqual([]);
    expect(codeHits('mcp', /\bnoCompetition\s*:/)).toEqual(['mcp/src/server.ts']);
    for (const i18nKey of ['competition.none', 'selection.none']) {
      const written = new RegExp(`['"\`]${i18nKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
      expect(hits('cli', written), i18nKey).toEqual([]);
      expect(hits('mcp', written), i18nKey).toEqual([]);
    }
    expect(codeHits('cli', /No competition chosen/)).toEqual([]);
    expect(codeHits('mcp', /No competition chosen/)).toEqual([]);
  });

  it('the market scope sentence has one copy, in the copy bank', () => {
    expect(MARKETS_SCOPE_NOTE).toBe('Market signals cover the World Cup only; none are read for this competition.');
    const written = /cover the World Cup only/;
    expect(codeHits('cli', written)).toEqual([]);
    expect(codeHits('mcp', written)).toEqual([]);
  });
});
