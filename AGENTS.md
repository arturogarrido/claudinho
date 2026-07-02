# AGENTS.md — Claudinho

Guidance for AI coding agents working **in this repository**. (Standard [AGENTS.md](https://agents.md); Claude Code reads it via `CLAUDE.md`.)

## What this is

Claudinho surfaces the 2026 men's football tournament in developer environments: a **CLI**, a **statusline** (Claude Code **and Cursor CLI** — `init claude`/`init cursor` one-step setup), an **MCP server** (also a **Cursor Marketplace plugin** + cursor.directory listing), a **score-aware hook** (Claude Code `UserPromptSubmit`), live scores/fixtures and **cumulative group standings** (from the provider's standings feed), a **knockout bracket**, read-only **prediction-market signals** (Polymarket odds — informational only), and **shareable terminal snippets** (`claudinho share` — copy-pasteable match **and standings** cards), and a **fuzzy team resolver** (`get_team` / `claudinho team` — a nation name or code → FIFA code + flag + group; the only **offline** MCP tool, `openWorldHint:false`; agents call it to resolve a user's team name into the code the other tools need). **Planned:** a desktop **notifier**, a precomputed **AI pundit**, and a small edge **gateway** that polls a data feed once for everyone.

## Stack

- TypeScript, Node ≥ 20, ES modules
- pnpm workspaces (monorepo) · tsup (build) · vitest (test) · Biome (lint)
- MCP: `@modelcontextprotocol/sdk`
- Gateway (_planned_, not yet built): Cloudflare Workers + KV + D1 (`services/gateway`)

## Layout

| Path | Package | Role |
|---|---|---|
| `packages/core` | `@claudinho/core` | domain model, provider adapters, normalize, tz, emoji flags, i18n, static schedule, bracket, validators |
| `packages/cli` | `@claudinho/cli` | the `claudinho` binary (CLI + statusline + hook + cache/refresher) |
| `packages/mcp` | `@claudinho/mcp` | stdio MCP server |
| `.cursor-plugin/plugin.json` + `mcp.json` (repo root) | — | Cursor Marketplace **plugin** — wraps `@claudinho/mcp` for cursor.com/marketplace. Plugin version is decoupled from npm (`npx -y @claudinho/mcp` = latest); guarded by `packages/mcp/test/cursor-plugin.test.ts`. |
| `packages/core/src/data/schedule.2026.json` | — | static fixtures, bundled into clients (regenerate via `pnpm -F @claudinho/core gen:schedule`) |
| `packages/core/src/markets` | — | prediction-market sidecar: `MarketSignal` model, `isReliableMarketSignal` gate, copy bank, `PolymarketProvider` (read-only public data; event slugs auto-derived per fixture), `mapping.2026.json` (slug overrides only, ships empty) |
| `packages/core/src/share` | — | shareable-snippet formatters: `formatShareSnippet` (match cards) and `formatShareTable` (group-standings cards); disclaimer non-optional, no ANSI, English-only copy in v1 (except `share bracket`, localized) |
| `.cursor/rules/*.mdc` | — | Cursor rules — the public, contributor-facing engineering guardrails (release discipline, surface parity, bracket/schedule invariants) |
| `packages/notifier` | `@claudinho/notifier` | _planned_ — `claudinho watch` daemon |
| `services/gateway` | — | _planned_ — edge API + SSE + cron |

## Commands

- `pnpm install` — install deps
- `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint` — across all packages (`lint` = Biome)
- `pnpm -F @claudinho/core test` — operate on a single package
- `pnpm release:qa` — pre-tag surface renderer (see "Release readiness")

## Releasing

Releases ship via `.github/workflows/publish.yml` on a `v*` tag, using npm **trusted
publishing** (OIDC) — **no `NPM_TOKEN`**. A trusted publisher is configured on npm for all
three packages (`@claudinho/core` · `cli` · `mcp`), all published **with provenance**.

To cut a release:

1. Bump the version in the **three** `package.json` files (`packages/{cli,mcp,core}/package.json`).
   The cli `--version` and MCP `serverInfo.version` are injected from package.json at build time
   (tsup `define` → `process.env.CLAUDINHO_VERSION`), so there are no source constants to touch.
   **Also bump `packages/mcp/mcpb/manifest.json`** — the `.mcpb` desktop-extension manifest carries
   its own `version`; a vitest guard (`packages/mcp/test/manifest.test.ts`) fails if it drifts.
2. `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint` (CI re-runs these). **For any
   user-facing change, also run `pnpm release:qa`** and eyeball every surface against the live feed
   before tagging (see "Release readiness").
3. Commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow gates (build/test/lint +
   tag==version), then `pnpm -r publish --provenance` ships all three via OIDC (versions already on
   npm are skipped) and auto-creates the GitHub Release (`gh release create --generate-notes`).

**MCP-affecting releases** (anything that changes a tool's shape or description) also bump
`packages/mcp/server.json` and re-publish to the MCP Registry — from the repo root, pass the path
(`mcp-publisher publish packages/mcp/server.json`), since `mcp-publisher` defaults to `./server.json`
in the cwd and ours isn't at the root.

**Adding or changing an MCP tool:** every tool declares an `outputSchema` and returns
`structuredContent` (`packages/mcp/src/server.ts`). A **new** tool must be added to
`OUTPUT_SCHEMAS` *and* to `packages/mcp/test/output-schema.test.ts` (which parses each handler's
`data` — healthy **and** degraded — against its schema). The output schemas are **hand-mirrored**
from the `@claudinho/core` types and kept permissive (`.passthrough()` on nested objects); the
`.strict()` top-level guard test is the safety net that catches schema/handler drift, so keep it
green. `build:mcpb` injects these schemas into the Smithery-scored `.mcpb` manifest.

**Smithery (`.mcpb`) re-publish** — optional, and only when you want the Smithery listing to
track a new version: `pnpm -F @claudinho/mcp build:mcpb` (stages `mcpb/manifest.json` + the tsup
server + its external deps, smoke-tests it, then `mcpb pack` → `packages/mcp/dist/claudinho-<v>.mcpb`),
then `smithery mcp publish <that .mcpb> -n arturogarrido/claudinho`. The bundle pins the server at
that version (it runs the bundled code, not `npx`-latest), so the listing is a snapshot until you
re-publish.

**Lessons (learned the hard way):**
- npm deprecated classic "Automation" tokens — use **trusted publishing**, not a token.
- A brand-new package can't have a trusted publisher pre-configured; its **first** publish must be
  a manual `pnpm -F @claudinho/<pkg> publish --access public` (enter OTP), then add its trusted
  publisher for later releases.
- Account 2FA set to "Authorization and writes" forces an OTP that CI can't supply; trusted
  publishing (OIDC) sidesteps it entirely.

## Commit attribution (all agents)

This repo is worked on by multiple AI coding agents. Commits produced with one are
**co-authored by the agent and the model** that wrote them, so `git log` (and the GitHub
contributors view) shows which agent — and which model — did the work. Add a trailer in the
**last paragraph** of the commit message, and credit the same in the PR body:

```
Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>
```

Use the model **actually in use**, not a hardcoded one. Examples, one per agent (Claude Code
uses Anthropic's no-reply address; Cursor and Codex follow the same pattern with their own):

```
Co-Authored-By: Claude Code (Opus 4.8) <noreply@anthropic.com>
Co-Authored-By: Cursor (Composer 2.5) <...>
Co-Authored-By: Codex (GPT-5) <noreply@openai.com>
```

## Reviewing PRs (all agents)

- For PR reviews, first verify the local checkout matches the PR head before running gates:
  `gh pr view <n> --json headRefOid,headRefName` and `git rev-parse HEAD`. If they differ,
  check out or fast-forward the PR branch before reviewing.
- Review-only tasks are read-only unless the user explicitly asks for fixes. Lead with findings,
  classify them P1/P2/P3, and include tight file/line references. If there are no findings, say
  that plainly and list the checks run plus any residual risk.
- Do not treat a previous review, memory, or local branch name as current truth. Re-check the PR
  SHA, merge state, and CI status at the end of the review.

## Codex / GPT specifics

- Codex has no separate sidecar guide in this repo; `AGENTS.md` is its source of truth. Follow
  the shared sections here: "Reviewing PRs", "Pre-PR self-review", "Release readiness", and
  "Commit attribution".
- If Codex makes a commit, use the actual GPT model in the `Co-Authored-By` trailer; the example
  above is illustrative, not a hardcoded model name.

## Conventions

- Shared domain types live in `@claudinho/core` — never duplicate them.
- Every data vendor implements the `ProviderAdapter` interface — keep providers swappable. Any new adapter MUST pass feed strings through `sanitizeFeedText` at its mapping boundary (the ESPN adapter's `toTeam`/`mapEspnEvent` is the model) — feed strings reach terminals, share cards, and Claude's context via the hook.
- Static data (schedule, groups, flags) ships bundled in clients; only **live state** hits the network.
- **Standings come from the provider's standings feed, NOT computed from a match window.** The bundled schedule is a resultless skeleton, and clients only fetch a ±1-day live window — so deriving a table from those matches yields a *wrong, partial* table mid-tournament (this was a real bug: groups not playing that day read all-zeros). `table`/`get_standings`/`standings://` go through core `getStandings` → optional `adapter.fetchStandings()` (authoritative cumulative table from ESPN's standings endpoint — the SAME endpoint `fetchGroupMap` already hits, so no new egress). It **fails closed** to a static roster-at-zero flagged `degraded` with no attribution — never a confidently-wrong table. `computeStandings` (match-derived) remains for that fallback only.
- **`CLAUDINHO_COMPETITION` is a deliberate keeper — do not remove it.** It points the live fetch at another ESPN competition (e.g. `fifa.friendly`) and is woven through both the live fetch and the **hot-path cache key** (the cache is competition-keyed). It looks dormant during the World Cup but is load-bearing — it's the seam for following other tournaments.
- **The bundled schedule is a resultless skeleton.** No scores/status, no confirmed nations in knockout slots. `sanitizeBundledFixture` restores topology placeholders; `gen:schedule` **fails loud** if any knockout fixture carries a real nation flag. Advancement comes only from the live overlay — clients never invent it from static JSON.
- **The live fixture's pairing wins over the static topology's winner-refs.** `buildBracketView`/`resolveSlot` resolve a knockout slot from the ESPN fixture ESPN actually serves for that match (`liveParticipant`), and only fall back to projecting a winner from the bundled `winner`/`loser` topology refs when that fixture is **absent from the merged set** (degraded feed). This is deliberate: the bundled winner-ref indices (parsed from ESPN's placeholder slot labels at generation time) do **not** reliably correspond to ESPN's actual R32→R16 feeder assignment, so projecting from them rendered **wrong R16 pairings** (v0.8.16 P1: "Paraguay vs Mexico" instead of the real ties). The topology is now structure/labels + a degraded-only fallback; the pairing is ESPN's. Guarded by the `P1 GUARD` case in `bracket-resolve.test.ts` (feeder ref disagrees with the live fixture → live wins).
- **Knockout/team-facing surfaces MUST live-resolve — never read the skeleton.** Because the bundle's knockout slots are 🏳️ placeholders (above), *every* team-facing surface must reach the live overlay (`getBracket` / `getNextFixtureForTeam`) to show real nations; a surface that reads the static bundle is **silently** blind to a confirmed tie (no crash, just a stale placeholder). This is Claudinho's most recurring bug: the *same* root cause shipped as v0.8.2 (R32 seeds), v0.8.6 (third-place slots), and v0.8.7 (next fixture) — three hotfixes, three different surfaces. **The surface list (keep in sync):** CLI `bracket` · `next` · `share bracket` · `share next`; MCP `get_bracket` · `get_next_fixture` · `get_share_snippet{bracket,next}`. The **statusline** can't fetch on the hot path (<150ms, cache-only), so it live-resolves *indirectly*: the cold-path refresher caches resolved knockout fixtures (`getKnockoutFixtures` → `CacheState.fixtures`) and the statusline reads them, **failing closed to `⚽ —`** (never a 🏳️ placeholder leak) when the cache lacks the pairing (v0.8.8; v0.8.9 adds empty-cache short TTL at phase boundaries and drops unresolved matchups from `live · syncing…`). **`cmdPrompt` and `cmdHook`** both spawn fixtures refresh in knockout phase. **Executable guard:** `packages/{cli,mcp}/test/knockout-surface-coverage.test.ts` pins one fake resolved tie (MEX vs ECU) and asserts every surface renders the real nations (the statusline from a seeded cache). **Add any new team-facing surface to that test** (and to `.cursor/rules/surface-parity.mdc`). **Deliberate exception — the MCP `fixtures://{date}` resource:** it is labeled "Static fixture list" and serves the bundled skeleton by design (a resource URI carries no timezone and gets no live overlay, so knockout slots stay 🏳️ placeholders there); agents needing live-resolved pairings use `get_today`/`get_bracket`. It is the only team-facing surface allowed to read the skeleton directly.
- Market signals use a separate `MarketProvider` interface (not `ProviderAdapter`). The Polymarket event slug is **derived per fixture** (`fifwc-{home}-{away}-{date}`), so most matches resolve with no mapping; `mapping.2026.json` holds slug **overrides only** (ships empty) and validation **fails closed**. Market-facing copy is English-only in v1 (the approved legal copy bank lives in `core/src/markets/format.ts`). Two derivation quirks (both fail-closed, both `release:qa`-tripwired): Polymarket slugs by the **host-local date** (try the UTC date + prior day — `deriveEventSlugs`), and it abbreviates some nations differently from their FIFA code (`POLYMARKET_TOKEN` alias table, e.g. `NED→nld`, `COD→cdr` — used by both slug derivation and outcome-market matching). Candidate-slug fetches honor the enrichment **deadline between candidates** (not just between fixtures), so alias fan-out (up to 8 slugs) never blocks default-on rendering.
- **The statusline and hook are English-only by design** — a deliberate carve-out from the four-locale rule. Both are single-line, latency-bound ambient surfaces whose few fixed tokens ("live · syncing…", "in 2d 4h", the hook's context label) stay EN; the interactive commands localize, the two ambient surfaces don't.
- **Shareable snippets** (`claudinho share`, the MCP `get_share_snippet` tool, `core/src/share`) are pure, deterministic **plain-text** artifacts (no ANSI — they get pasted): English-only copy in v1 **except `share bracket`** (localized en/es/pt/fr via `ShareBracketOptions.locale`; the non-affiliation disclaimer + hashtag stay EN as fixed strings), market lines reuse the approved copy bank verbatim (`marketBlock`/`marketLine`, never hand-composed), and the non-affiliation disclaimer is **non-optional** (only the hashtag and install cue are toggleable). They use the same reliable market gate as `today`/`match` and are **never** on the statusline/hook hot path. **`share table <GROUP>`** produces a standings card — facts + emoji flags only, **no market line**; a degraded (roster-only) card carries an explicit not-live notice so it can't paste as real.
- **Star CTAs are human-interactive-only.** The npm→GitHub conversion nudges — `claudinho star`, the every-Nth dimmed footer on `today`/`live`/`next`/`table`/`bracket`/`match`/`team`, the post-`init` line, and the README callouts — live ONLY on interactive human surfaces. They are **never** on the hot path (statusline `prompt` / `hook`), **never** in `--json` or piped output (`process.stdout.isTTY`-gated, with a `CLAUDINHO_NO_STAR` opt-out), and **never** in MCP tool output/descriptions (that's agent context — a "star us" there wastes tokens and can leak to end users). The footer counter (`packages/cli/src/starNudge.ts`) is best-effort and never throws: a CTA must not break, slow, or pollute a command.

## Hard constraints (legal — do not violate)

- **Facts + emoji flags only.** Never add team crests, kits, player photos/likenesses, broadcast footage, or FIFA/Anthropic logos or wordmarks.
- Keep the dual disclaimer — *"Not affiliated with FIFA or Anthropic"* — on user-facing surfaces.
- Attribute data providers; respect their rate limits.
- **Prediction-market data is read-only and informational.** Public market data only — no wallet/auth/CLOB/trading endpoints, no outbound market links (`url` stays `null`). Never frame odds as betting/trading advice (no "bet/wager/value/edge/lock"); keep the *"informational only"* caveat and attribute the provider (Polymarket). Market signals are a **sidecar** — never embedded in `Match`, and never read on the statusline/hook hot path (a regression test enforces this).

## Pre-PR self-review (run before declaring a change "done")

This is the lens an external reviewer uses — apply it yourself first. For changes
touching money/legal/external APIs, also run an **independent adversarial pass**
(e.g. a reviewer subagent with fresh eyes on the diff) and self-classify any
findings **P1/P2/P3**.

1. **Verify external contracts against ground truth.** For any new API/integration,
   fetch a *real* response and confirm the parser **and the test fixtures** match it.
   Never ship against an assumed payload shape — green tests built on a wrong fixture
   prove nothing.
2. **Apply the change to *every* surface.** Enumerate them: CLI (text **and** `--json`),
   MCP (structured `data` **and** text), statusline/hook, share, and the READMEs. A behavior
   that lands on 3 of 4 surfaces is a bug — and "every surface" means each surface's *args*
   (tz/locale/flags) are threaded, not just that the surface exists.
3. **Audit the whole touched area against the Hard Constraints — including pre-existing
   code, not just the diff** (e.g. "attribute data providers" applies to *every*
   provider, not only the one you added).
4. **Adversarial failure-mode pass per new code path:** empty / missing / malformed
   input; transient vs. permanent error (never cache a transient failure as a real
   "no result"); duplicate / ambiguous data; timeout / deadline / concurrency. Default
   to **fail-closed**.
5. **State the worst-case latency/cost of any default-on path** under realistic load
   (e.g. "N sequential fetches × T timeout") and bound it (deadline + cache).
6. **Sync the meta in the same change:** READMEs, the Cursor rules (`.cursor/rules/`), MCP
   tool descriptions, and release guards (`publish.yml`, pinned tool versions). Flag any
   claim that went stale.

## Definition of Done (per user-facing feature, not per PR)

The Pre-PR rubric above is per *change*. A feature that spans several PRs also needs a
**feature-level** acceptance gate — the bracket feature became a core release plus four
reactive dot-releases because each gap (ambiguous dates, missing host-nation flags, a
dropped `tz` on MCP `get_bracket`) was found by *using* the feature after it was already
live. Before implementing a user-facing feature, write 3–5 acceptance criteria **from the
user's point of view** and don't call it done until each holds on a real terminal:

- The output is **unambiguous** to read (e.g. "which calendar day is this match?" across a 3-week span).
- Every entity renders **consistently with the rest of the product** (host nations show flags like every other team; no static/placeholder leaks; the resultless invariant holds).
- It behaves across **all timezones, all four locales** (en/es/pt/fr), and **every surface** (CLI text + `--json`, MCP `data` + text, share) — not just en/local/CLI.
- It **fails closed** (degraded feed → honest TBD/notice, never an invented or stale fact).

Scope these up front so the feature ships whole, not in dot-release pieces.

## Release readiness — run `scripts/release-qa.sh` before tagging

"Test it on a real terminal first" is executable: **`scripts/release-qa.sh`** (`pnpm release:qa`)
renders *every* user-facing surface against the **live feed, across two timezones and all four
locales**, and ends with tripwires for known regression classes (bracket shows a calendar date,
`tz` is actually threaded, disclaimers intact; it SKIPs rather than fails on a degraded/unreachable
feed, so a network blip never blocks a release). Build, run it, **read the output**, then tag. It
does not replace the eyeball — its job is to put every surface in front of you so nothing ships
unseen. (It covers CLI/share rendering; MCP arg-threading is guarded by
`packages/mcp/test/tools.test.ts` — keep that green too.)

## Release cadence — batch, don't dot-release per fix

Two kinds of release, and only one is urgent:

- **Hotfix-now** — live data *correctness* only (a wrong score/standing *during* a match,
  or a feed outage rendering as authoritative). Ship immediately.
- **Everything else** — UX, polish, cosmetics, follow-on sub-features — **batch** onto the
  working branch and release as a single bump. Stack review fixes for the same feature into the
  same PR before merge.

Every release carries real toil (a multi-file version bump, and for MCP-affecting changes an MCP
Registry re-publish). Fewer, fuller releases cut that directly. When unsure, accumulate.

## Don't

- Don't put API keys in client packages — keys live **only** in the gateway.
- Don't block the statusline hot path on the network — read from the local cache (<150ms).
