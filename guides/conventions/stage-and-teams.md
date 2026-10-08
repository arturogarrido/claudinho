# Conventions: stages and teams

This guide holds the narration behind the `AGENTS.md` "Conventions" bullet "The stage comes from a written grammar over the WHOLE season slug, with the competition's written kind", moved out of `AGENTS.md` word for word. It also holds what `.cursor/rules/trust-boundary.mdc` and `.cursor/rules/surface-parity.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## The stage comes from a written grammar over the WHOLE season slug, with the competition's written kind

Measured on the real feed (Oct 3, 2026): the season slugs above, `torneo-apertura` and `clausura---quarterfinals|semifinals|finals` (`mex.1`), `league-phase` (`uefa.champions`, `uefa.nations`), `knockout-round-playoffs` (`uefa.champions`), `relegation-playoffs` (`uefa.nations`), and the tournament rounds. UNMEASURED, so `OTHER` with their words until written down: `ita.1`'s and `ger.1`'s play-offs, and `fifa.cwc` (no event served).

## From `.cursor/rules/trust-boundary.mdc`

### Rules

- **A `Team` has one constructor and one identity.** `sealTeam` builds every team — feed competitors, standings rows, cache records. `id` is the provider's stable id, namespaced (`espn:359`), kept only when it matches the grammar and dropped otherwise on every path alike.

## From `.cursor/rules/surface-parity.mdc`

### A club has no flag; the stage is written, not guessed

Every reader states the kind: the adapter passes its competition to both parsers, and the cache readers (`liveMatchesFromCache`, `sealFixtures`) take `teamKind(competition)` from their callers (`cmdPrompt`, `cmdHook`, `cmdVibe`, the refresher).

The stage comes from the written grammar over the whole season slug (`stageFromSlug`, with `COMPETITION_KIND` and `SEASON_SLUG`): a league's season is `REGULAR` ("League"), a cup's league phase `LEAGUE` ("League phase"), play-offs `PO` ("Play-offs"), and anything the grammar does not know `OTHER` with the provider's words (`stageLabel`), or nothing at all when the slug is absent or unreadable. CLI `next`/`match` and the MCP text print it localized (`stageLabelI18n(lang, match)`), the cards in English (`stageLabel(match)`).
