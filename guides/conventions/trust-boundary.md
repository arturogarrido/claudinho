# Conventions: the trust boundary

This guide holds the narration behind the `AGENTS.md` "Conventions" bullets "Every data vendor implements the `ProviderAdapter` interface" and "Text has ROLES, not one universal cleaner", moved out of `AGENTS.md` word for word and in the bullets' order. Where a bullet kept the first clause of a sentence, the guide quotes that clause before the narration that followed it. It also holds what `.cursor/rules/trust-boundary.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## Every data vendor implements the `ProviderAdapter` interface

(AGENTS.md keeps "Cache readers call the **same** constructors:") when the live and cache paths had separate rules, every fix landed on one of them and left the other open — the asymmetry behind most of the security findings in #96.

## Text has ROLES, not one universal cleaner

That last one is load-bearing: while flags travelled through the text filter, the filter needed an emoji carve-out, and a carve-out without its own grammar is a covert channel (TAG characters, variation selectors and ZWJ each rode through it in turn — a `🏴` plus 42 tag characters is one 2-column glyph spelling a full instruction sentence).

## From `.cursor/rules/trust-boundary.mdc`

### Rules

- **An adapter FETCHES; it does not interpret.** The adapter that also parsed is how `id` and `kickoff` ended up copied verbatim while every string beside them was cleaned.
- **Record refusal is local, not a provider outage.** Parser-local `BoundedList.complete` is diagnostic; never promote one refused record into a batch-wide blackout.
- **Both paths end at the same constructor.** Live and cache reads call `sealMatch` / `sealMarketSignal`. When they had separate rules, each fix landed on one of them; `core/test/trust-parity.test.ts` asserts they agree, as a JSON round trip, because that is literally what the cache file is.
- **Text has roles.** `humanLabel` is prose — no controls, no format characters, **no emoji**, bounded by display columns *and* code points. `opaqueId` is checked against an exact grammar. `canonicalTimestamp` re-emits one form and refuses a date that does not exist. `productFlag` GENERATES the flag from the nation, and only for a nation: `sealTeam(raw, kind)` takes the competition's written team kind (`TEAM_KIND`), and a club gets no flag key at all. Unstated, two defaults: the core constructor and the parsers read a team as a CLUB (`SealOptions.teamKind`, a parse with no `competition`); the ambient renderers (`renderPrompt`, `renderHook`) default through `defaultTeamKind`: the bundle's NATIONS, unless `defaultCompetition` is false, and then clubs.
- **Never accept a product glyph from input.** A `🏴` plus 42 tag characters is ONE two-column glyph spelling a full instruction sentence — invisible on a terminal, legible to a model reading `--json`.
- **Fail closed on ABSENCE.** A missing field must be at least as rejecting as a wrong one. Five market gates were `x != null && ...`, so the more malformed payload was the more successful one.

### Changing this area

Add the property to `core/test/trust-properties.test.ts` (table-driven off each type's declared key list, so a new field fails by default), and **verify it goes red** with the rule reverted — a property test you have not made fail is pinning nothing. If it is a claim `SECURITY.md` makes, cite the test there; `core/test/security-claims.test.ts` fails if a citation rots.
