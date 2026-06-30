# Contributing to Claudinho ⚽

Thanks for being here. Claudinho is an independent, open-source fan project for the
2026 men's football tournament — a CLI, a statusline, a score-aware hook, and an MCP
server. Issues, fixes, and ideas are all welcome.

**The fastest way to help: [⭐ star the repo](https://github.com/arturogarrido/claudinho).**
It's a solo, $0 project, and stars are the signal that it's worth maintaining.

## Ways to contribute

- **Report a bug** — a wrong score, a rendering glitch, a timezone/locale issue. Include
  the command you ran, your `--tz`/`--lang`, and what you saw vs. expected.
- **Suggest an idea** — open an issue before a large PR so we can align on scope.
- **Pick up a [`good first issue`](https://github.com/arturogarrido/claudinho/labels/good%20first%20issue)** —
  small, well-scoped starting points (new locale strings, a docs fix, a small surface tweak).

## Dev loop

```bash
pnpm install
pnpm -r build        # build every package
pnpm -r test         # vitest across packages (pnpm -F @claudinho/core test for one)
pnpm -r typecheck
pnpm lint            # Biome (lint-only; keep style consistent with surrounding code)
```

Try your change end-to-end before opening a PR:

```bash
node packages/cli/dist/index.js today --tz America/Mexico_City --lang es
```

## What to know before a PR

- **Read [`AGENTS.md`](AGENTS.md) first** — it's the engineering guide: the package
  layout, the provider/adapter model, the resultless-schedule and knockout
  live-resolve invariants, and the "apply the change to every surface" rule (CLI text
  **and** `--json`, MCP `data` **and** text, share, READMEs).
- **Hard constraints (legal — don't violate):** facts and **emoji flags only** — never
  crests, kits, player photos, or FIFA/Anthropic logos. Keep the *"Not affiliated with
  FIFA or Anthropic"* disclaimer on user-facing surfaces. Prediction-market data is
  **read-only and informational only** — never betting/trading framing.
- **Shared types live in `@claudinho/core`** — don't duplicate them; run
  `pnpm -r typecheck` after changing them.
- **Tests + the full gate must pass** (`build` / `test` / `typecheck` / `lint`). For
  user-facing changes, also run `pnpm release:qa` and eyeball the output.

## Commit attribution

Several AI coding agents work on this repo. If you used one, add a trailer in the last
paragraph of the commit (and credit it in the PR), using the model actually in use — e.g.
`Co-Authored-By: Claude Code (Opus 4.8) <noreply@anthropic.com>`. See `AGENTS.md` →
"Commit attribution" for the convention.

## Code of conduct

Be kind and constructive. This is a fan project built for fun during the tournament —
keep it that way. 💛

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
