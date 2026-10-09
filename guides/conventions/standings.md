# Conventions: standings

This guide holds the narration behind the `AGENTS.md` "Conventions" bullet "Standings come from the provider's standings feed, NOT computed from a match window", moved out of `AGENTS.md` word for word. `AGENTS.md` stays canonical.

## Standings come from the provider's standings feed, NOT computed from a match window

The bundled schedule is a resultless skeleton, and clients only fetch a ±1-day live window — so deriving a table from those matches yields a *wrong, partial* table mid-tournament (this was a real bug: groups not playing that day read all-zeros).
