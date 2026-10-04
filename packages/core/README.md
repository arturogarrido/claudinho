# @claudinho/core ⚽

Shared domain model, data-provider adapters, a read-only market-signal sidecar,
and helpers for **Claudinho** — the 2026 men's football tournament in your dev
environment. This is the engine behind
[`@claudinho/cli`](https://www.npmjs.com/package/@claudinho/cli) and
[`@claudinho/mcp`](https://www.npmjs.com/package/@claudinho/mcp).

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> An independent, open-source fan project. Facts + emoji flags only.

## Install

```bash
npm i @claudinho/core
```

## What's inside

- **Domain model** — `Match` (incl. `venue`/`city`/`country`), `Team` (a display `code`, a `name`, a `flag` generated from a nation's name, absent for a club, and the provider's stable `id` such as `espn:359` when the team came from a live feed), `Stage` (the tournament rounds, `REGULAR` for a league's season, `LEAGUE` for a cup's league phase, `PO` for play-offs, `OTHER` with the provider's own words in `stageLabel`), `Status`, `PunditPick`, `LedgerRow`
- **`ProviderAdapter`** — the swappable data-vendor interface (`fetchByDate`, `fetchLive`, optional `fetchWindow`/`fetchStandings`); `EspnAdapter` included. An adapter serves exactly one competition and states it (`competition`, required); a provider that knows which season a response belongs to attaches it to the returned array (`attachFetchMeta`, read with `fetchMeta`), with the seasons its parts stated (`seasons`) and the records it left out (`omitted`). A window whose parts state two seasons is refused unless it is asked `acrossSeasons`, which three callers that merge nothing do (the live read, and off the bundled competition the dated read and the match refresh); `getNextFixtureForTeam`, `getBracket`, `getMatchesForDate`, `getLiveMatches`, `getMatchById` and `marketFixtureForTeam` say `partial` when the read behind them was not whole (`dayAttribution` and the "none read" sentences in the card builders say what that means for a day), and `verdictExtras` / `verdictNotice` / `verdictQualifiers` turn a result's verdict into a key and a sentence
- **Static schedule** — all 104 fixtures (groups, venues, host cities, kickoffs) bundled; query with `allFixtures`, `fixturesByDate` (groups by your timezone), `fixturesByTeam`, `fixturesByGroup`, `nextFixtureForTeam`, `groups`
- **Live overlay** — `makeAdapter(source, { competition })`, `getMatchesForDate`, `getLiveMatches`, `mergeLive` (static base + live state, with graceful degradation). The competition is resolved once by the caller (`resolveCompetition(explicit, env, saved)`: an alias or a slug, the first present source deciding, then the World Cup; anything else is refused with the aliases; core reads no environment, the caller hands it in), and said by `modeLine` and `selectionExtras`; the bundled schedule is merged only for its own competition and edition (`bundleApplies`)
- **The supported set** — `SUPPORTED`, ONE table of the fifteen competitions (slug, alias, name, teams, kind, season name, standings shape, bracket and markets capabilities, cadence); `deriveTables(table)` builds every written view from it, and `entryOf`, `capabilitiesOf`, `competitionLabel`, `listCompetitions` take a table, so a new row reaches every consumer
- **Standings** — `getStandings` fetches authoritative, cumulative tables from the provider (`GroupStandings`: a table has a key, `A`, `A1`, `A-B` or `LEAGUE`, and every table but a lettered group a `label`), failing closed when none is available, and saying `incomplete` when the provider sent a table that could not be read: the compatible bundled World Cup scope may return a degraded roster-at-zero, while custom competitions return empty + degraded rather than borrowing those teams; `computeStandings` derives a table from a set of matches (points / GD / GF tiebreak)
- **Helpers** — emoji flags (`nationToFlag`), TZ-aware time (`formatKickoff`, `formatDate`, `formatTime`, `countdown`, `localDate`), location strings (`matchLocation`), localized commentary flair (`matchFlavor` / `FlavorLevel`), validators (`isValidDate`, `isValidTimeZone`)
- **Prediction-market signals (sidecar)** — read-only market signals kept *separate* from `Match`: the `MarketSignal` / `MarketProvider` model, the `PolymarketProvider` (public Gamma data only — no auth/trading/links; event slugs auto-derived per fixture, validation fails closed), a `FakeMarketProvider`, `makeMarketProvider`, `getMarketSignal` / `getMarketSignals`, the `isReliableMarketSignal` gate, and approved-copy formatters (`marketFavoriteText`, `marketProbabilityText`, `marketBlock`). Informational only — never betting advice.
- **Shareable snippets** — `formatShareSnippet` builds pure, deterministic, plain-text match cards (composing `Match` + the market copy bank); `formatShareTable` does the same for standings, one table or all of them (facts + emoji flags only, no market line). For the CLI's `share` command and MCP/site reuse. The non-affiliation disclaimer is non-optional; market lines come from the approved bank.

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
