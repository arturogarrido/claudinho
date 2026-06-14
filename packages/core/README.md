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

- **Domain model** — `Match` (incl. `venue`/`city`/`country`), `Team`, `Stage`, `Status`, `PunditPick`, `LedgerRow`
- **`ProviderAdapter`** — the swappable data-vendor interface (`fetchByDate`, `fetchLive`, optional `fetchWindow`/`fetchStandings`); `EspnAdapter` included
- **Static schedule** — all 104 fixtures (groups, venues, host cities, kickoffs) bundled; query with `allFixtures`, `fixturesByDate` (groups by your timezone), `fixturesByTeam`, `fixturesByGroup`, `nextFixtureForTeam`, `groups`
- **Live overlay** — `makeAdapter`, `getMatchesForDate`, `getLiveMatches`, `mergeLive` (static base + live state, with graceful degradation)
- **Standings** — `getStandings` fetches authoritative, cumulative group tables from the provider (`GroupStandings`), failing closed to a roster-at-zero when none is available; `computeStandings` derives a table from a set of matches (points / GD / GF tiebreak)
- **Helpers** — emoji flags (`nationToFlag`), TZ-aware time (`formatKickoff`, `formatDate`, `formatTime`, `countdown`, `localDate`), location strings (`matchLocation`), localized commentary flair (`matchFlavor` / `FlavorLevel`), validators (`isValidDate`, `isValidTimeZone`)
- **Prediction-market signals (sidecar)** — read-only market signals kept *separate* from `Match`: the `MarketSignal` / `MarketProvider` model, the `PolymarketProvider` (public Gamma data only — no auth/trading/links; event slugs auto-derived per fixture, validation fails closed), a `FakeMarketProvider`, `makeMarketProvider`, `getMarketSignal` / `getMarketSignals`, the `isReliableMarketSignal` gate, and approved-copy formatters (`marketFavoriteText`, `marketProbabilityText`, `marketBlock`). Informational only — never betting advice.
- **Shareable snippets** — `formatShareSnippet` builds pure, deterministic, plain-text match cards (composing `Match` + the market copy bank); `formatShareTable` does the same for a group's standings (facts + emoji flags only, no market line). For the CLI's `share` command and MCP/site reuse. The non-affiliation disclaimer is non-optional; market lines come from the approved bank.

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
