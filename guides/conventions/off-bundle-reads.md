# Conventions: reads off the bundled competition

This guide holds the narration behind the `AGENTS.md` "Conventions" bullets "Off the bundled competition, `next`, `match <id>` and `bracket` answer from the competition itself" and "A window is composed of the requests the provider accepts", moved out of `AGENTS.md` word for word and in the bullets' order. Where the narration continues a sentence `AGENTS.md` kept, or refers to one, the guide quotes that sentence or clause first. It also holds what `.cursor/rules/trust-boundary.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## Off the bundled competition, `next`, `match <id>` and `bracket` answer from the competition itself

(AGENTS.md keeps "The end is the provider's STATED season end (`ended`: its calendar day), an administrative date, not the last match:") on the real feed the World Cup's slug states Dec 31 and league seasons follow each other, so the sentence is said where the provider says a season ended and no next one has started.

## A window is composed of the requests the provider accepts

ESPN refuses date ranges (`dates=A-B`, since Oct 2026) and serves one day or one calendar month. A day response states the season of the DATE asked, and each competition turns on its own date (June 1, July 1, January 1, measured), so a window's parts can state two seasons.

## From `.cursor/rules/trust-boundary.mdc`

### Rules

- **A composed window fails as a whole on what no sibling can stand in for.** A caller that composes windows itself (discovery: a window per month) asks "no readable record" of the whole too: a window refused because its list held no readable record carries `ProviderError.noReadableRecord` and read nothing; an envelope nobody could read carries no such mark and still fails it.
