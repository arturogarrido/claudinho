/**
 * Guard: every flag this product emits is one Unicode RECOMMENDS for general
 * interchange (an RGI flag sequence), and a nation whose flag it does not
 * recommend carries no flag at all.
 *
 * A tag sequence is drawn as its flag only when it is one of the three
 * subdivision flags Unicode recommends (England `gbeng`, Scotland `gbsct`,
 * Wales `gbwls`); any other (`gbnir`, Northern Ireland, seen on the published
 * CLI on Nov 10, 2026) falls back to a plain black flag on every platform, the
 * shape the club-coverage guard watches for as a placeholder. A pair of
 * regional indicators is drawn as a flag only for a code Unicode lists; any
 * other is two boxed letters (the Intl fallback used to map Zimbabwe to the
 * withdrawn `RH`, Yemen to `YD`, Vanuatu to `NH`).
 *
 * Three answers, kept apart: a recommended flag (a nation that has one),
 * `undefined` (a nation with none: rendered by its name, like a club, and
 * RESOLVED, not a placeholder), and the neutral 🏳️ (no nation at all: a bundle
 * placeholder, "Round of 32 1 Winner").
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlaceholderSide } from '../src/bracket/placeholders';
import * as flags from '../src/flags';
import { flagEmoji, nationToFlag } from '../src/flags';
import { parseCachedMatch, parseEspnEvent, productFlag, sealTeam } from '../src/trust';

const NEUTRAL = '🏳️';
/** Unicode's own definition, the property the guard is written against. */
// The constructor, not a literal: the compiler targets ES2022 and refuses a `v` literal (TS1501); the runtime (Node >= 22) has the flag.
// biome-ignore lint/complexity/useRegexLiterals: a `v` literal does not compile under the ES2022 target.
const RECOMMENDED = new RegExp('^(?:\\p{RGI_Emoji_Flag_Sequence}|\\p{RGI_Emoji_Tag_Sequence})$', 'v');
const TAG = /[\u{E0000}-\u{E007F}]/u;
const ENGLAND = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f);
const SCOTLAND = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f);
const WALES = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0077, 0xe006c, 0xe0073, 0xe007f);

const FLAGS_SRC = join(__dirname, '..', 'src', 'flags.ts');

/** Every name and every 3-letter code a flags table spells, read from its source text. */
function tableEntries(src: string): { names: string[]; codes: string[] } {
  const names = [...src.matchAll(/\['([^']+)', '[A-Z]{2}(?:-[A-Z]{2,3})?'\]/g)].map((m) => m[1] as string);
  const codes = [...src.matchAll(/\b([A-Z]{3}): '/g)].map((m) => m[1] as string);
  return { names, codes };
}

/** Every English region name Intl knows (the fallback's whole domain). */
function intlNames(): string[] {
  const dn = new Intl.DisplayNames(['en'], { type: 'region' });
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = dn.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code) out.push(name);
    }
  }
  return out;
}

/** What the guard needs of a flags module: its lookup and its written list of nations with no recommended flag. */
type FlagsModule = {
  nationToFlag: (q: string) => string | undefined;
  FLAGLESS_NATIONS: ReadonlyArray<{ readonly name: string; readonly code: string }>;
};

const recommended = (f: string | undefined): boolean => typeof f === 'string' && RECOMMENDED.test(f);
const shown = (f: string | undefined): string =>
  f === undefined ? 'none' : f === NEUTRAL ? 'neutral' : [...f].map((c) => c.codePointAt(0)?.toString(16)).join(' ');

/**
 * The guard. WHO may get which answer, since `undefined` is a legal one:
 *   - a name or code the table spells is a nation: a recommended flag, or none
 *     ONLY when the written flagless list names it (never the placeholder);
 *   - an Intl region name: a recommended flag, or the placeholder (no nation),
 *     never none (Intl knows no flagless nation of ours);
 *   - every entry of the flagless list: none.
 * Returns the violations as `<name> -> <answer>`.
 */
function violations(src: string, mod: FlagsModule): string[] {
  const { names, codes } = tableEntries(src);
  const flagless = new Set(mod.FLAGLESS_NATIONS.flatMap((f) => [f.name, f.code]));
  const bad: string[] = [];
  for (const n of [...names, ...codes]) {
    const f = mod.nationToFlag(n);
    const ok = flagless.has(n) ? f === undefined : recommended(f);
    if (!ok) bad.push(`${n} -> ${shown(f)}`);
  }
  for (const n of intlNames()) {
    const f = mod.nationToFlag(n);
    if (!(f === NEUTRAL || recommended(f))) bad.push(`${n} -> ${shown(f)}`);
  }
  for (const n of flagless) {
    const f = mod.nationToFlag(n);
    if (f !== undefined) bad.push(`${n} -> ${shown(f)}`);
  }
  return bad;
}

describe('every flag the product emits is one Unicode recommends', () => {
  it('the guard is wired up: the table, Intl and the flagless list all have entries to check', () => {
    const { names, codes } = tableEntries(readFileSync(FLAGS_SRC, 'utf8'));
    expect(names.length).toBeGreaterThan(100);
    expect(codes.length).toBeGreaterThan(50);
    expect(intlNames().length).toBeGreaterThan(200);
    expect(flags.FLAGLESS_NATIONS).toEqual([{ name: 'Northern Ireland', code: 'NIR' }]);
  });

  it('every name and code in the table is a nation with a recommended flag (none only for the written flagless list); every Intl name a recommended flag or no nation', () => {
    expect(violations(readFileSync(FLAGS_SRC, 'utf8'), flags)).toEqual([]);
  });

  it('productFlag is that lookup, on every name the guard reads', () => {
    const { names, codes } = tableEntries(readFileSync(FLAGS_SRC, 'utf8'));
    for (const n of [...names, ...codes, ...intlNames(), 'Northern Ireland', 'NIR']) expect(productFlag(n), n).toBe(flags.nationToFlag(n));
  });

  it('the guard FAILS on a copy of the table with a row whose code is no real region (Kosovo XK -> XQ)', async () => {
    const src = readFileSync(FLAGS_SRC, 'utf8');
    const typo = src.replace("['Kosovo', 'XK']", "['Kosovo', 'XQ']");
    expect(typo).not.toBe(src);
    // The copy is written inside the package so the test runner transforms it; flags.ts imports nothing.
    const path = join(__dirname, `.flags-copy-${process.pid}-${Date.now()}.ts`);
    writeFileSync(path, typo);
    try {
      const copy = (await import(path)) as FlagsModule;
      expect(violations(typo, copy)).toContain('Kosovo -> none');
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('flagEmoji never emits a sequence Unicode does not recommend, for any 2-letter code or GB subdivision', () => {
    const bad: string[] = [];
    const regions: string[] = [];
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) regions.push(String.fromCharCode(a, b));
    regions.push('GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR', 'GB-XYZ', 'GB-EN', 'US-CA', 'ES-CT', 'FR-IDF');
    for (const r of regions) {
      const f = flagEmoji(r);
      if (f !== NEUTRAL && !RECOMMENDED.test(f)) bad.push(r);
    }
    expect(bad).toEqual([]);
  });

  it('a tag sequence is only ever one of the three Unicode recommends', () => {
    expect(flagEmoji('GB-ENG')).toBe(ENGLAND);
    expect(flagEmoji('GB-SCT')).toBe(SCOTLAND);
    expect(flagEmoji('GB-WLS')).toBe(WALES);
    for (const r of ['GB-NIR', 'GB-XYZ', 'US-CA', 'ES-CT', 'gb-nir']) expect(flagEmoji(r), r).toBe(NEUTRAL);
    expect(nationToFlag('England')).toBe(ENGLAND);
    expect(nationToFlag('SCO')).toBe(SCOTLAND);
    expect(nationToFlag('Wales')).toBe(WALES);
  });

  it('a well-formed region code with no recommended flag is not drawn as two letters', () => {
    for (const r of ['ZZ', 'EZ', 'QO', 'XA', 'XB', 'RH', 'YD', 'NH', 'BU', 'UK']) expect(flagEmoji(r), r).toBe(NEUTRAL);
  });
});

describe('Northern Ireland: a nation whose flag Unicode does not recommend', () => {
  it('has no flag, by name and by code: not a tag sequence, not the black flag, not the placeholder', () => {
    for (const q of ['Northern Ireland', 'northern ireland', 'NIR']) {
      expect(nationToFlag(q), q).toBeUndefined();
      expect(productFlag(q), q).toBeUndefined();
    }
  });

  it('is sealed as a nation with NO flag key (a club\'s shape), and is resolved, not a placeholder', () => {
    const t = sealTeam({ id: 'espn:2617', code: 'NIR', name: 'Northern Ireland' }, 'nation');
    expect(t).toBeDefined();
    expect(t).not.toHaveProperty('flag');
    expect(t).toEqual({ code: 'NIR', name: 'Northern Ireland', id: 'espn:2617' });
    expect(isPlaceholderSide(t as NonNullable<typeof t>)).toBe(false);
  });

  it('the live path and the cache path agree, key order included', () => {
    const payload = {
      id: '401800001',
      date: '2026-11-17T19:45Z',
      season: { slug: 'league-phase' },
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
      competitions: [
        {
          venue: { fullName: 'Puskás Aréna', address: { city: 'Budapest' } },
          competitors: [
            { homeAway: 'home', team: { id: '2611', abbreviation: 'HUN', displayName: 'Hungary' } },
            { homeAway: 'away', team: { id: '2617', abbreviation: 'NIR', displayName: 'Northern Ireland' } },
          ],
        },
      ],
    };
    const live = parseEspnEvent(payload, { competition: 'uefa.nations' });
    expect(live.kind).toBe('valid');
    if (live.kind !== 'valid') return;
    expect(live.value.home.flag).toBe('🇭🇺');
    expect(live.value.away).not.toHaveProperty('flag');
    expect(JSON.stringify(live.value)).not.toMatch(TAG);
    const back = parseCachedMatch(JSON.parse(JSON.stringify(live.value)), { teamKind: 'nation' });
    expect(back.kind).toBe('valid');
    if (back.kind !== 'valid') return;
    expect(JSON.stringify(back.value)).toBe(JSON.stringify(live.value));
  });

  it('a supplied flag in a cache file is still never read (the hostile tag payload included)', () => {
    const r = parseCachedMatch(
      {
        id: '401800001',
        stage: 'LEAGUE',
        kickoff: '2026-11-17T19:45:00.000Z',
        venue: 'Puskás Aréna',
        home: { code: 'HUN', name: 'Hungary', flag: '🇭🇺' },
        away: { code: 'NIR', name: 'Northern Ireland', flag: String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe006e, 0xe0069, 0xe0072, 0xe007f) },
        status: 'SCHEDULED',
        updatedAt: '2026-11-17T12:00:00.000Z',
      },
      { teamKind: 'nation' },
    );
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value.away).not.toHaveProperty('flag');
  });
});

describe('the Intl fallback picks the code whose flag Unicode recommends', () => {
  it('a withdrawn code never wins over the current one', () => {
    expect(nationToFlag('Zimbabwe')).toBe('🇿🇼');
    expect(nationToFlag('Yemen')).toBe('🇾🇪');
    expect(nationToFlag('Vanuatu')).toBe('🇻🇺');
    expect(nationToFlag('Myanmar (Burma)')).toBe('🇲🇲');
  });

  it('a name Intl gives a region with no flag at all is no nation: the neutral placeholder', () => {
    for (const n of ['Eurozone', 'Unknown Region', 'Outlying Oceania', 'Pseudo-Accents', 'Pseudo-Bidi']) {
      expect(nationToFlag(n), n).toBe(NEUTRAL);
    }
  });
});
