/**
 * The supported set, as ONE table: the sixteen competitions the product
 * answers for, one row each, and every written fact about a competition that
 * the rest of the code reads (the names a person may type for it, its teams'
 * kind, its own kind, a league's season name, its standings shape, what
 * `bracket` and the market sidecar offer, how often it has an edition). Every
 * other table derives from this one
 * ({@link deriveTables}): `TEAM_KIND`, `COMPETITION_KIND`, `SEASON_SLUG`,
 * `STANDINGS_SHAPE` (`kinds.ts`), `NO_BRACKET` (`competition.ts`),
 * `MARKET_COMPETITIONS` (`markets/provider.ts`); `bracketCapability`, the
 * canary's competitions and cadences and the README matrix read the rows.
 * Adding a competition is one row here plus its fixtures; nothing else in the
 * source changes.
 *
 * A LEAF module: it imports nothing. The trust layer reads the derived kinds
 * at parse time (through `kinds.ts`), and `competition.ts` imports the adapter,
 * which imports the trust layer; a table with imports of its own could be read
 * uninitialized on one of those paths.
 *
 * Every lookup is by own property, or by equality on a row's slug: the
 * competition reaches the code from a flag, an environment variable or a tool
 * argument, and `constructor` is not one.
 */

/** Whether a competition fields nations (a flag is generated from the name) or clubs (no flag). */
export type TeamKind = 'nation' | 'club';

/**
 * What a surface does for a competition: `offered`; `not-offered-yet` (the
 * competition may have it, the product does not read it yet); `not-applicable`
 * (the competition has no such thing: a league season with no knockout tie
 * has no bracket, a knockout-only cup has no table).
 */
export type Capability = 'offered' | 'not-offered-yet' | 'not-applicable';

/** One supported competition, as written down. */
export interface CompetitionEntry {
  /** The provider's slug (`eng.1`): what a request asks for. */
  readonly slug: string;
  /**
   * What a person types (`premier-league`): lower-case letters and digits in
   * words joined by single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), never a dot,
   * at most 64 units (`deriveTables` refuses any other at load).
   */
  readonly alias: string;
  /** What a surface names it (`Premier League`): the provider's name, shortened where it says the country. */
  readonly name: string;
  /**
   * Other names a person may type for it (`English Premier League`): human
   * names, matched as a name is (see {@link competitionValue}); absent where
   * there is none. Never printed: a surface names it by `name`.
   */
  readonly otherNames?: readonly string[];
  /**
   * The short forms a person may type for it (`epl`, `pl`): 2 to 6 lower-case
   * letters or digits (`deriveTables` refuses any other at load), matched as a
   * name is; absent where there is none. `follow --list` prints them beside
   * the name.
   */
  readonly shortForms?: readonly string[];
  /** The teams it fields. */
  readonly teams: TeamKind;
  /** A league (its season is the regular stage) or a cup (rounds and phases). */
  readonly kind: 'league' | 'cup';
  /**
   * The season NAME a league's regular season is filed under, as measured on
   * the real feed (`2026-27-english-premier-league`: the year in front varies,
   * the name is this one, matched whole); absent where there is none.
   */
  readonly seasonSlug?: string;
  /**
   * How its standings are read: `league` (authorised to serve exactly ONE
   * table: a fact of the competition, never inferred from a payload having one
   * child), `groups` (lettered or numbered groups), `none` (no table at all:
   * knockout from the first round).
   */
  readonly standings: 'league' | 'groups' | 'none';
  /** What `bracket` is for it. */
  readonly bracket: Capability;
  /** What the market sidecar is for it (Claudinho's slug derivation, not the market provider's coverage). */
  readonly markets: Capability;
  /**
   * How often it has an edition, in years: a season turn steps up by at most
   * this (at most, not exactly: the Copa America went 2021, 2024, 2028).
   */
  readonly cadenceYears: 1 | 2 | 4;
}

/**
 * The competition whose schedule and knockout topology ship bundled in the
 * clients: the World Cup. Written once, here (the adapter's
 * `DEFAULT_COMPETITION` and `BUNDLE_COMPETITION` are this value): it is the
 * only competition a row may offer a bracket for.
 */
export const BUNDLED_SLUG = 'fifa.world';

/**
 * The sixteen, in the order they are listed.
 *   - Nations: the World Cup, the Euro, the Copa America (four-yearly), the
 *     UEFA Nations League, the Concacaf Nations League (its next editions are
 *     2026/27 and 2028/29, by Concacaf's published 2026 to 2030 calendar) and
 *     the Gold Cup (two-yearly).
 *   - The six leagues, yearly. A league's season name as measured on the real
 *     feed (Oct 3, 2026); `mex.1` and `uru.1` have none (their slugs are
 *     `torneo-apertura`, `torneo-clausura` and, for `mex.1`, its play-off
 *     rounds).
 *   - The four club cups. The Champions League's league phase reads as one
 *     table; the Concacaf Champions Cup has none (knockout from the first
 *     round); the Club World Cup is four-yearly.
 * `bracket`: offered on the World Cup alone (its topology ships bundled);
 * not applicable for the Premier League and LaLiga, 38-round leagues with no
 * play-off; not offered yet elsewhere (`ita.1` has had championship and
 * relegation play-offs since the FIGC's May 2026 decision, `ger.1` a
 * relegation play-off, `mex.1` the Liguilla, `uefa.champions` a knockout after
 * the league phase). A competition joins "not applicable" by a written fact.
 * `markets`: offered on the World Cup alone: the sidecar derives its event
 * slugs from the World Cup series only.
 * `otherNames` and `shortForms`: what a person may type besides the alias and
 * the name (`English Premier League`, `epl`), each owned by ONE row
 * (`deriveTables` refuses a key two rows share) and none a word a command
 * argument already means (`off`, a command's name, a day word such as `sat`).
 */
export const SUPPORTED: readonly CompetitionEntry[] = Object.freeze(
  (
    [
      { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', otherNames: ['FIFA World Cup'], shortForms: ['wc'], teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'offered', markets: 'offered', cadenceYears: 4 },
      { slug: 'uefa.euro', alias: 'euro', name: 'EURO', otherNames: ['European Championship'], shortForms: ['euros'], teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 4 },
      { slug: 'conmebol.america', alias: 'copa-america', name: 'Copa América', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 4 },
      { slug: 'uefa.nations', alias: 'nations-league', name: 'UEFA Nations League', shortForms: ['unl'], teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 2 },
      { slug: 'concacaf.nations.league', alias: 'concacaf-nations-league', name: 'Concacaf Nations League', shortForms: ['cnl'], teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 2 },
      { slug: 'concacaf.gold', alias: 'gold-cup', name: 'Gold Cup', otherNames: ['Concacaf Gold Cup'], shortForms: ['gold'], teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 2 },
      { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', otherNames: ['English Premier League'], shortForms: ['epl', 'pl'], teams: 'club', kind: 'league', seasonSlug: 'english-premier-league', standings: 'league', bracket: 'not-applicable', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', teams: 'club', kind: 'league', seasonSlug: 'laliga', standings: 'league', bracket: 'not-applicable', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'ita.1', alias: 'serie-a', name: 'Serie A', teams: 'club', kind: 'league', seasonSlug: 'italian-serie-a', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'ger.1', alias: 'bundesliga', name: 'Bundesliga', shortForms: ['buli'], teams: 'club', kind: 'league', seasonSlug: 'german-bundesliga', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'mex.1', alias: 'liga-mx', name: 'Liga MX', shortForms: ['lmx'], teams: 'club', kind: 'league', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'uru.1', alias: 'liga-auf', name: 'Liga AUF Uruguaya', shortForms: ['auf'], teams: 'club', kind: 'league', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'uefa.champions', alias: 'champions-league', name: 'Champions League', otherNames: ['UEFA Champions League'], shortForms: ['ucl', 'cl'], teams: 'club', kind: 'cup', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'conmebol.libertadores', alias: 'libertadores', name: 'Libertadores', otherNames: ['Copa Libertadores', 'CONMEBOL Libertadores'], teams: 'club', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'concacaf.champions', alias: 'concacaf-champions-cup', name: 'Concacaf Champions Cup', shortForms: ['ccc'], teams: 'club', kind: 'cup', standings: 'none', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'fifa.cwc', alias: 'club-world-cup', name: 'Club World Cup', otherNames: ['FIFA Club World Cup'], shortForms: ['cwc'], teams: 'club', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 4 },
    ] satisfies CompetitionEntry[]
  ).map((e) => Object.freeze(e)),
);

/** A short form's grammar: 2 to 6 lower-case letters or digits. */
const SHORT_FORM = /^[a-z0-9]{2,6}$/;
/** An alias's grammar: lower-case letters and digits in words joined by single hyphens. */
const ALIAS = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * A character nobody sees (`Default_Ignorable_Code_Point`: a combining
 * grapheme joiner, a variation selector, a joiner, a zero-width space): a
 * value holding one is refused, never repaired into a name.
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
/** A usable name key, once normalized: letters and digits, nothing else. */
const NAME_KEY = /^[a-z0-9]+$/;
/** The longest value matched as a name, in UTF-16 units: bounded before any work. */
const MAX_NAME_UNITS = 64;
/** The longest normalized value a suggestion is looked for. */
const MAX_SUGGEST_KEY = 32;
/** The most aliases a refusal suggests. */
const MAX_SUGGESTIONS = 2;

/**
 * A typed name as the grammar compares it: decomposed (`NFD`) and stripped of
 * its combining marks (`América`, precomposed or decomposed, is `America`),
 * lower-cased, and with the U+0020 space, the hyphen and the underscore
 * removed (`Premier League`, `premier-league` and `premier_league` are
 * `premierleague`). Undefined, with no work done, for a value longer than
 * {@link MAX_NAME_UNITS}; undefined, before any mark is stripped, for a value
 * holding a default-ignorable character (a combining grapheme joiner, a
 * variation selector, a zero-width joiner or space: some of them are marks,
 * and stripping them would repair an invisible character into a name); and
 * undefined for anything but `^[a-z0-9]+$` after the rest (a tab, a no-break
 * space or a control character stays, and the result is not a usable key).
 */
function nameKey(value: string): string | undefined {
  if (value.length > MAX_NAME_UNITS) return undefined;
  const decomposed = value.normalize('NFD');
  if (INVISIBLE.test(decomposed)) return undefined;
  const key = decomposed.replace(/\p{M}/gu, '').toLowerCase().replace(/[ _-]/g, '');
  return NAME_KEY.test(key) ? key : undefined;
}

/** A row's usable name keys: its alias, name, other names and short forms, normalized. */
function nameKeys(e: CompetitionEntry): string[] {
  const keys: string[] = [];
  for (const v of [e.alias, e.name, ...(e.otherNames ?? []), ...(e.shortForms ?? [])]) {
    const k = nameKey(v);
    if (k !== undefined) keys.push(k);
  }
  return keys;
}

/**
 * The LATER words of some of a row's names, each as a key from that word to
 * the end (`Liga AUF Uruguaya`: `aufuruguaya`, `uruguaya`): words split on a
 * space, a hyphen or an underscore.
 */
function laterWordKeys(names: readonly string[]): string[] {
  const keys: string[] = [];
  for (const v of names) {
    const words = v.split(/[ _-]+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      const k = nameKey(words.slice(i).join(' '));
      if (k !== undefined) keys.push(k);
    }
  }
  return keys;
}

/** The Levenshtein distance between two short keys (both bounded by the caller). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** A lookup table keyed by slug: no prototype, frozen, so a key is only ever a row's. */
function record<V>(pairs: Iterable<readonly [string, V]>): Readonly<Record<string, V>> {
  const out: Record<string, V> = Object.create(null);
  for (const [k, v] of pairs) out[k] = v;
  return Object.freeze(out);
}

/**
 * A set no caller can change: frozen, and its mutators refuse (`Object.freeze`
 * alone leaves a Set's `add` working).
 */
function frozenSet(values: Iterable<string>): ReadonlySet<string> {
  const set = new Set(values);
  for (const method of ['add', 'delete', 'clear']) {
    Object.defineProperty(set, method, {
      value: () => {
        throw new TypeError('a derived view is read-only');
      },
    });
  }
  return Object.freeze(set);
}

/** Every written fact a consumer reads, as derived from one table. */
export interface DerivedTables {
  /** The teams each competition fields. */
  readonly teamKind: Readonly<Record<string, TeamKind>>;
  /** Each competition's kind. */
  readonly competitionKind: Readonly<Record<string, 'league' | 'cup'>>;
  /** A league's season name, where it has one. */
  readonly seasonSlug: Readonly<Record<string, string>>;
  /** The standings shape where it is not groups (the default). */
  readonly standingsShape: Readonly<Record<string, 'league' | 'none'>>;
  /** The competitions with no bracket (`not-applicable`). */
  readonly noBracket: ReadonlySet<string>;
  /** The competitions the market sidecar reads (`offered`). */
  readonly marketCompetitions: ReadonlySet<string>;
}

/**
 * The views every consumer reads, derived from a table. A function of the
 * table, so a test can run it on one with a row past the table's end and
 * see every view carry it. Every view is frozen.
 *
 * A row that offers a bracket for any competition but the bundled one is
 * REFUSED here, at load, naming it: an offered bracket needs a knockout
 * topology the clients ship, and only the bundled competition has one (the
 * same question as `bundleApplies(slug)` with no season, asked of the leaf's
 * own constant), so a wrong row never reaches a user.
 *
 * So are, naming it, every key a lookup accepts that this guard could not
 * check: an alias outside its grammar (lower-case letters and digits in words
 * joined by single hyphens, at most 64 units), a name or an other name with no
 * usable key ({@link nameKey}: longer than 64 units, an invisible or a
 * control character, anything but letters, digits, spaces, hyphens and
 * underscores once accents are stripped), a short form outside its grammar
 * (2 to 6 lower-case letters or digits), and a name key two rows share (an
 * alias, a name, an other name or a short form, compared as
 * {@link competitionValue} compares them: `Premier League`, `premier_league`
 * and `premierleague` are one key): a value a person types names one row or
 * none.
 */
export function deriveTables(entries: readonly CompetitionEntry[]): DerivedTables {
  const owner = new Map<string, string>();
  for (const e of entries) {
    if (e.bracket === 'offered' && e.slug !== BUNDLED_SLUG) {
      throw new Error(`${e.slug} offers a bracket the bundle does not describe: only the bundled competition ships a topology`);
    }
    if (e.alias.length > MAX_NAME_UNITS || !ALIAS.test(e.alias)) {
      throw new Error(`${e.slug}'s alias "${e.alias.slice(0, MAX_NAME_UNITS)}" is not lower-case words joined by single hyphens, at most ${MAX_NAME_UNITS} units`);
    }
    for (const n of [e.name, ...(e.otherNames ?? [])]) {
      if (nameKey(n) === undefined) throw new Error(`${e.slug}'s name "${n.slice(0, MAX_NAME_UNITS)}" has no usable key`);
    }
    for (const s of e.shortForms ?? []) {
      if (!SHORT_FORM.test(s)) throw new Error(`${e.slug}'s short form "${s}" is not 2 to 6 lower-case letters or digits`);
    }
    for (const key of new Set(nameKeys(e))) {
      const other = owner.get(key);
      if (other !== undefined) throw new Error(`the name key "${key}" belongs to both ${other} and ${e.slug}`);
      owner.set(key, e.slug);
    }
  }
  return Object.freeze({
    teamKind: record(entries.map((e) => [e.slug, e.teams] as const)),
    competitionKind: record(entries.map((e) => [e.slug, e.kind] as const)),
    seasonSlug: record(
      entries.flatMap((e) => (e.seasonSlug !== undefined ? [[e.slug, e.seasonSlug] as const] : [])),
    ),
    standingsShape: record(
      entries.flatMap((e) => (e.standings === 'groups' ? [] : [[e.slug, e.standings] as const])),
    ),
    noBracket: frozenSet(entries.filter((e) => e.bracket === 'not-applicable').map((e) => e.slug)),
    marketCompetitions: frozenSet(entries.filter((e) => e.markets === 'offered').map((e) => e.slug)),
  });
}

/** The views of the supported table itself: what the product's code reads. */
export const SUPPORTED_TABLES: DerivedTables = deriveTables(SUPPORTED);

/** A competition's row, by its slug; undefined for a slug the table does not hold. */
export function entryOf(
  slug: string | undefined,
  table: readonly CompetitionEntry[] = SUPPORTED,
): CompetitionEntry | undefined {
  return slug === undefined ? undefined : table.find((e) => e.slug === slug);
}

/**
 * A raw ESPN slug: two or more lower-case segments of letters, digits and
 * underscores, joined by single dots (`fifa.friendly`, `esp.copa_del_rey`:
 * real slugs carry underscores, measured on the feed). Nothing else: no upper
 * case, no space, no leading, trailing or double dot.
 */
const RAW_SLUG = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
/** The longest raw slug believed, in UTF-16 units. */
const MAX_SLUG_UNITS = 64;

/**
 * What ONE value names, by the grammar every source of a selection shares
 * (a flag, the environment, the saved choice, a tool's `competition`
 * argument), in this order:
 *   - the row whose alias or slug it is, exactly;
 *   - for a value WITHOUT a dot, the row one of whose names it is: its alias,
 *     its name, an other name or a short form, compared as {@link nameKey}
 *     compares them (case, accents, spaces, hyphens and underscores ignored:
 *     `Premier League`, `PREMIER-LEAGUE`, `epl`; a value holding an
 *     invisible character is refused, never repaired). A prefix is not a name
 *     (`premier` is refused, and {@link suggestCompetitions} then names the
 *     alias);
 *   - for a value with a dot, `raw` when it is a well-formed slug the table
 *     does not hold (experimental), and nothing else (`ENG.1` is refused);
 *   - undefined for anything else (`foo`, a tab, an empty string).
 * A value longer than 64 units (the slug bound and the name bound alike) is
 * refused FIRST, before any search, normalization or match: the work is
 * bounded before it starts, whatever the value holds.
 * Every lookup is a search of the rows, never a key of an object
 * (`constructor` is refused). The resolver (`competition.ts`) and the config
 * file's reader (`userConfig.ts`) ask this one question, so the file can never
 * hold a value the resolver would refuse.
 */
export function competitionValue(
  value: unknown,
  table: readonly CompetitionEntry[] = SUPPORTED,
): { row: CompetitionEntry } | { raw: string } | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (value.length > MAX_SLUG_UNITS || value.length > MAX_NAME_UNITS) return undefined;
  const row = table.find((e) => e.alias === value) ?? entryOf(value, table);
  if (row) return { row };
  if (value.includes('.')) {
    return value.length <= MAX_SLUG_UNITS && RAW_SLUG.test(value) ? { raw: value } : undefined;
  }
  const key = nameKey(value);
  if (key === undefined) return undefined;
  const named = table.find((e) => nameKeys(e).includes(key));
  return named ? { row: named } : undefined;
}

/**
 * The aliases a refused value is nearest to: at most two, nearest first, the
 * same answer every time. By these steps:
 *   0. nothing for a value longer than 64 units (refused before any other
 *      work), a value that resolves ({@link competitionValue}: an exact
 *      match is not a near miss), a value with a dot (the slug grammar
 *      suggests nothing), or one whose normalized form ({@link nameKey}) is not
 *      letters and digits or is longer than 32;
 *   1. with 3 characters or more: the rows one of whose whole keys (alias,
 *      name, other name, short form) STARTS with it (`premier`, `copa`);
 *   2. with 3 characters or more: the rows where a LATER word of the alias or
 *      the name starts with it (the key from that word to the end: `cup` is
 *      `world-cup`'s, `uruguay` is `Liga AUF Uruguaya`'s), then the rows where
 *      a later word of an other name does (an other name is the farther one:
 *      `champions` is `concacaf-champions-cup` before `European
 *      Championship`);
 *   3. with 5 characters or more: the rows with a whole key within 2 edits
 *      (Levenshtein: `bundesliag`), nearest first.
 * Step 1's rows come first, then step 2's, then step 3's; within a step, ties
 * go by the table's order; each row once; at most two.
 */
export function suggestCompetitions(value: string, table: readonly CompetitionEntry[] = SUPPORTED): string[] {
  if (typeof value !== 'string' || value.length > MAX_NAME_UNITS) return [];
  if (value.includes('.') || competitionValue(value, table) !== undefined) return [];
  const key = nameKey(value);
  if (key === undefined || key.length > MAX_SUGGEST_KEY) return [];
  const picked: CompetitionEntry[] = [];
  const take = (rows: Iterable<CompetitionEntry>) => {
    for (const e of rows) {
      if (picked.length >= MAX_SUGGESTIONS) return;
      if (!picked.includes(e)) picked.push(e);
    }
  };
  if (key.length >= 3) {
    take(table.filter((e) => nameKeys(e).some((k) => k.startsWith(key))));
    take(table.filter((e) => laterWordKeys([e.alias, e.name]).some((k) => k.startsWith(key))));
    take(table.filter((e) => laterWordKeys(e.otherNames ?? []).some((k) => k.startsWith(key))));
  }
  if (key.length >= 5) {
    const near = table
      .map((e, i) => ({ e, i, d: Math.min(...nameKeys(e).map((k) => editDistance(key, k))) }))
      .filter((x) => x.d <= 2)
      .sort((a, b) => a.d - b.d || a.i - b.i);
    take(near.map((x) => x.e));
  }
  return picked.map((e) => e.alias);
}

/** What each surface is for a competition. */
export interface Capabilities {
  readonly scores: Capability;
  readonly next: Capability;
  readonly standings: Capability;
  readonly bracket: Capability;
  readonly markets: Capability;
}

/**
 * A competition's capability row. Scores and the next fixture are the generic
 * reads, offered on every competition; standings are offered unless the
 * competition has no table; bracket and markets are the row's. A slug the
 * table does not hold (a raw slug) gets the generic reads and nothing else.
 */
export function capabilitiesOf(slug: string, table: readonly CompetitionEntry[] = SUPPORTED): Capabilities {
  const e = entryOf(slug, table);
  return Object.freeze({
    scores: 'offered',
    next: 'offered',
    standings: e?.standings === 'none' ? 'not-applicable' : 'offered',
    bracket: e ? e.bracket : 'not-offered-yet',
    markets: e ? e.markets : 'not-offered-yet',
  });
}

/** What a surface names a competition: its row's name, or a raw slug as it is. */
export function competitionLabel(slug: string, table: readonly CompetitionEntry[] = SUPPORTED): string {
  return entryOf(slug, table)?.name ?? slug;
}

/** One competition as a listing states it. */
export interface ListedCompetition {
  readonly slug: string;
  readonly alias: string;
  readonly name: string;
  readonly teams: TeamKind;
  readonly kind: 'league' | 'cup';
  readonly capabilities: Capabilities;
}

/**
 * The table as a listing: every row with its capabilities, in the table's
 * order, and the current selection as the caller states it (`null` when
 * there is none). No edition state: whether an edition is current is a fact
 * of a READ (`betweenEditions`), never of the table.
 */
export function listCompetitions<C>(
  table: readonly CompetitionEntry[],
  current: C | null,
): { competitions: ListedCompetition[]; current: C | null } {
  return {
    competitions: table.map((e) => ({
      slug: e.slug,
      alias: e.alias,
      name: e.name,
      teams: e.teams,
      kind: e.kind,
      capabilities: capabilitiesOf(e.slug, table),
    })),
    current,
  };
}
