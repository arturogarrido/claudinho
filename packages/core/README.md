# @claudinho/core ⚽

**The engine behind Claudinho: the domain model, the provider adapters (ESPN), live scores
and standings for the competition you follow (15 supported), the bundled 2026 World Cup
schedule with its knockout bracket and read-only Polymarket sidecar.** Claudinho puts live
football in your dev environment for the competition you follow: the World Cup, the Premier
League, LALIGA, the Champions League and 11 more. This package powers
[`@claudinho/cli`](https://www.npmjs.com/package/@claudinho/cli) and
[`@claudinho/mcp`](https://www.npmjs.com/package/@claudinho/mcp).

> ⚠️ **Not affiliated with FIFA, any confederation, league or club, or Anthropic. Nor endorsed by or connected to any of them.**
> An independent, open-source fan project. Facts + emoji flags only.

## Install

```bash
npm i @claudinho/core
```

## What's inside

- **Domain model**: `Match` (incl. `venue`/`city`/`country`), `Team` (a display `code`, a `name`, a `flag` generated from a nation's name, absent for a club, and the provider's stable `id` such as `espn:359` when the team came from a live feed), `Stage` (the tournament rounds, `REGULAR` for a league's season, `LEAGUE` for a cup's league phase, `PO` for play-offs, `OTHER` with the provider's own words in `stageLabel`), `Status`, `PunditPick`, `LedgerRow`
- **`ProviderAdapter`**: the swappable data-vendor interface (`fetchByDate`, `fetchLive`, optional `fetchWindow`/`fetchStandings`); `EspnAdapter` included. An adapter serves exactly one competition and states it (`competition`, required); a provider that knows which season a response belongs to attaches it to the returned array (`attachFetchMeta`, read with `fetchMeta`), with the seasons its parts stated (`seasons`) and the records it left out (`omitted`). A window whose parts state two seasons is refused unless it is asked `acrossSeasons`, which three callers that merge nothing do (the live read, and off the bundled competition the dated read and the match refresh); `getNextFixtureForTeam`, `getBracket`, `getMatchesForDate`, `getLiveMatches`, `getMatchById` and `marketFixtureForTeam` say `partial` when the read behind them was not whole (`dayAttribution` and the "none read" sentences in the card builders say what that means for a day), and `verdictExtras` / `verdictNotice` / `verdictQualifiers` turn a result's verdict into a key and a sentence
- **Static schedule**: the World Cup's 104 fixtures (groups, venues, host cities, kickoffs) bundled (the other competitions' schedules are read from the feed); query with `allFixtures`, `fixturesByDate` (groups by your timezone), `fixturesByTeam`, `fixturesByGroup`, `nextFixtureForTeam`, `groups`
- **Live overlay**: `makeAdapter(source, { competition })`, `getMatchesForDate`, `getLiveMatches`, `mergeLive` (static base + live state, with graceful degradation). The competition is resolved once by the caller (`resolveCompetition(explicit, env, saved)`: an alias or a slug, the first present source deciding (the flag, the environment, the saved choice the caller read with `readUserConfig`); with none it answers `none`, nothing chosen, never a default; anything else is refused with the aliases; core reads no environment and no file, the caller hands them in), and said by `modeLine` and `selectionExtras`; the bundled schedule is merged only for its own competition and edition (`bundleApplies`)
- **The supported set**: `SUPPORTED`, ONE table of the fifteen competitions (slug, alias, name, teams, kind, season name, standings shape, bracket and markets capabilities, cadence); `deriveTables(table)` builds every written view from it, and `entryOf`, `capabilitiesOf`, `competitionLabel`, `listCompetitions` take a table, so a new row reaches every consumer
- **Standings**: `getStandings` fetches authoritative, cumulative tables from the provider (`GroupStandings`: a table has a key, `A`, `A1`, `A-B` or `LEAGUE`, and every table but a lettered group a `label`), failing closed when none is available, and saying `incomplete` when the provider sent a table that could not be read: the compatible bundled World Cup scope may return a degraded roster-at-zero, while custom competitions return empty + degraded rather than borrowing those teams; `computeStandings` derives a table from a set of matches (points / GD / GF tiebreak)
- **Helpers**: emoji flags (`nationToFlag`), TZ-aware time (`formatKickoff`, `formatDate`, `formatTime`, `countdown`, `localDate`), location strings (`matchLocation`), localized commentary flair (`matchFlavor`, `flavorsFor` for a list with no phrase twice, `matchFlair` for a line's flair slot / `FlavorLevel`; the team rally cries, `rallyCryFor` / `RALLY_CRIES`), validators (`isValidDate`, `isValidTimeZone`)
- **Prediction-market signals (sidecar)**: read-only market signals kept *separate* from `Match`: the `MarketSignal` / `MarketProvider` model, the `PolymarketProvider` (public Gamma data only: no auth/trading/links; event slugs auto-derived per fixture, validation fails closed), a `FakeMarketProvider`, `makeMarketProvider`, `getMarketSignal` / `getMarketSignals`, the `isReliableMarketSignal` gate, and approved-copy formatters (`marketFavoriteText`, `marketProbabilityText`, `marketBlock`). Informational only, never betting advice.
- **Shareable snippets**: `formatShareSnippet` builds pure, deterministic, plain-text match cards (composing `Match` + the market copy bank); `formatShareTable` does the same for standings, one table or all of them (facts + emoji flags only, no market line). For the CLI's `share` command and MCP/site reuse. The non-affiliation disclaimer is non-optional (`DISCLAIMER`, the one sentence every surface imports; `disclaimerLine(host)` adds a listing host's clause); market lines come from the approved bank.

## Example

```ts
import { allFixtures, nextFixtureForTeam, formatKickoff } from '@claudinho/core';

const next = nextFixtureForTeam('MEX');
console.log(next?.home.flag, 'vs', next?.away.flag,
  formatKickoff(next!.kickoff, { tz: 'America/Mexico_City', locale: 'es' }));
```

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
