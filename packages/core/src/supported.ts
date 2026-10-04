/**
 * The supported set, as ONE table: the fifteen competitions the product
 * answers for, one row each, and every written fact about a competition that
 * the rest of the code reads (its teams' kind, its own kind, a league's season
 * name, its standings shape, what `bracket` and the market sidecar offer, how
 * often it has an edition). Every other table derives from this one
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
  /** What a person types (`premier-league`): lower case, digits and hyphens, never a dot. */
  readonly alias: string;
  /** What a surface names it (`Premier League`): the provider's name, shortened where it says the country. */
  readonly name: string;
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
 * The fifteen, in the order they are listed.
 *   - Nations: the World Cup, the Euro, the Copa America (four-yearly), the
 *     UEFA Nations League, the Concacaf Nations League (its next editions are
 *     2026/27 and 2028/29, by Concacaf's published 2026 to 2030 calendar) and
 *     the Gold Cup (two-yearly).
 *   - The five leagues, yearly. A league's season name as measured on the real
 *     feed (Oct 3, 2026); `mex.1` has none (its slugs are `torneo-apertura`,
 *     `torneo-clausura` and its play-off rounds).
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
 */
export const SUPPORTED: readonly CompetitionEntry[] = Object.freeze(
  (
    [
      { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'offered', markets: 'offered', cadenceYears: 4 },
      { slug: 'uefa.euro', alias: 'euro', name: 'EURO', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 4 },
      { slug: 'conmebol.america', alias: 'copa-america', name: 'Copa América', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 4 },
      { slug: 'uefa.nations', alias: 'nations-league', name: 'UEFA Nations League', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 2 },
      { slug: 'concacaf.nations.league', alias: 'concacaf-nations-league', name: 'Concacaf Nations League', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 2 },
      { slug: 'concacaf.gold', alias: 'gold-cup', name: 'Gold Cup', teams: 'nation', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 2 },
      { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', teams: 'club', kind: 'league', seasonSlug: 'english-premier-league', standings: 'league', bracket: 'not-applicable', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', teams: 'club', kind: 'league', seasonSlug: 'laliga', standings: 'league', bracket: 'not-applicable', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'ita.1', alias: 'serie-a', name: 'Serie A', teams: 'club', kind: 'league', seasonSlug: 'italian-serie-a', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'ger.1', alias: 'bundesliga', name: 'Bundesliga', teams: 'club', kind: 'league', seasonSlug: 'german-bundesliga', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'mex.1', alias: 'liga-mx', name: 'Liga MX', teams: 'club', kind: 'league', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'uefa.champions', alias: 'champions-league', name: 'Champions League', teams: 'club', kind: 'cup', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'conmebol.libertadores', alias: 'libertadores', name: 'Libertadores', teams: 'club', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'concacaf.champions', alias: 'concacaf-champions-cup', name: 'Concacaf Champions Cup', teams: 'club', kind: 'cup', standings: 'none', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 },
      { slug: 'fifa.cwc', alias: 'club-world-cup', name: 'Club World Cup', teams: 'club', kind: 'cup', standings: 'groups', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 4 },
    ] satisfies CompetitionEntry[]
  ).map((e) => Object.freeze(e)),
);

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
 * table, so a test can run it on one with a sixteenth row and see every view
 * carry it. Every view is frozen.
 *
 * A row that offers a bracket for any competition but the bundled one is
 * REFUSED here, at load, naming it: an offered bracket needs a knockout
 * topology the clients ship, and only the bundled competition has one (the
 * same question as `bundleApplies(slug)` with no season, asked of the leaf's
 * own constant), so a wrong row never reaches a user.
 */
export function deriveTables(entries: readonly CompetitionEntry[]): DerivedTables {
  for (const e of entries) {
    if (e.bracket === 'offered' && e.slug !== BUNDLED_SLUG) {
      throw new Error(`${e.slug} offers a bracket the bundle does not describe: only the bundled competition ships a topology`);
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
