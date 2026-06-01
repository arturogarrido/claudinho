# @claudinho/core ⚽

Shared domain model, data-provider adapters, and helpers for **Claudinho** —
the 2026 men's football tournament in your dev environment. This is the engine
behind [`@claudinho/cli`](https://www.npmjs.com/package/@claudinho/cli) and
[`@claudinho/mcp`](https://www.npmjs.com/package/@claudinho/mcp).

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> An independent, open-source fan project. Facts + emoji flags only.

## Install

```bash
npm i @claudinho/core
```

## What's inside

- **Domain model** — `Match`, `Team`, `Stage`, `Status`, `PunditPick`, `LedgerRow`
- **`ProviderAdapter`** — the swappable data-vendor interface; `EspnAdapter` included
- **Static schedule** — all 104 fixtures (groups, venues, kickoffs) bundled; query with `allFixtures`, `fixturesByDate`, `fixturesByTeam`, `fixturesByGroup`, `nextFixtureForTeam`, `groups`
- **Live overlay** — `makeAdapter`, `getMatchesForDate`, `getLiveMatches`, `mergeLive` (static base + live state, with graceful degradation)
- **Standings** — `computeStandings` (points / GD / GF tiebreak)
- **Helpers** — emoji flags (`nationToFlag`), TZ-aware time (`formatKickoff`, `countdown`, `localDate`), validators (`isValidDate`, `isValidTimeZone`)

## Example

```ts
import { allFixtures, nextFixtureForTeam, formatKickoff } from '@claudinho/core';

const next = nextFixtureForTeam('MEX');
console.log(next?.home.flag, 'vs', next?.away.flag,
  formatKickoff(next!.kickoff, { tz: 'America/Mexico_City', locale: 'es' }));
```

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)
