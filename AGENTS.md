# AGENTS.md — Claudinho

Guidance for AI coding agents working **in this repository**. (Standard [AGENTS.md](https://agents.md); Claude Code reads it via `CLAUDE.md`.)

## Working agreement

- Complete the requested work through validation and self-review. Resolve routine implementation
  choices from the code and state material assumptions; ask when missing information would change
  the intended behavior or scope. Continue independent work while awaiting an answer.
- Plans, audits, and reviews are read-only unless the user asks for edits. Preserve unrelated local
  changes. Apply existing authorization without asking again; a local edit does not by itself
  authorize a push, merge, tag, or publish.
- Read the files and applicable rules needed for the task. This file is the canonical repository
  guide; `CLAUDE.md` adds Claude-specific setup, and `.cursor/rules/` mirrors focused rules. Apply
  direct user instructions over repository workflow defaults, within system/developer constraints.
  If a rule blocks authorized work, cite the exact rule and explain the conflict.
- Treat memory, prior reviews, and model recommendations as context. Verify changing facts against
  current source, configuration, and the live PR head before relying on them. Keep durable project
  rules here rather than copying them into personal memory or another agent guide.
- Preserve the user's selected model and effort. Both are set and checked in the coding client; a
  model recommendation in these guides does not change that setting or prove a model performs
  better on this project.
- Use an independent reviewer for the cases required under "Pre-PR self-review". Give each reviewer
  a bounded scope and reconcile their evidence. Other delegation follows the user's instructions
  and the coding client's rules.
- Report the outcome, checks actually run, and unresolved limitations concisely. For reviews, lead
  with actionable findings and exact file/line references. Distinguish a skipped check from a pass.

## What this is

Claudinho surfaces the 2026 men's football tournament in developer environments: a **CLI**, a **statusline** (Claude Code **and Cursor CLI** — `init claude`/`init cursor` one-step setup), an **MCP server** (also a **Cursor Marketplace plugin** + cursor.directory listing), a **score-aware hook** (Claude Code `UserPromptSubmit`), live scores/fixtures and **cumulative group standings** (from the provider's standings feed), a **knockout bracket**, read-only **prediction-market signals** (Polymarket odds — informational only), and **shareable terminal snippets** (`claudinho share` — copy-pasteable match **and standings** cards), and a **fuzzy team resolver** (`get_team` / `claudinho team` — a nation name or code → FIFA code + flag + group; the only **offline** MCP tool, `openWorldHint:false`; agents call it to resolve a user's team name into the code the other tools need). **Planned:** a desktop **notifier**, a precomputed **AI pundit**, and a small edge **gateway** that polls a data feed once for everyone.

## Stack

- TypeScript, Node ≥ 20, ES modules
- pnpm workspaces (monorepo) · tsup (build) · vitest (test) · Biome (lint-only; formatter disabled)
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
| `packages/core/src/share` | — | shareable snippets: the card builders (`cards.ts`: what a live, date, next, match, table or bracket card says, assembled once for the CLI and MCP) and the formatters (`formatShareSnippet`, `formatShareTable`, `formatShareBracket`); disclaimer non-optional, no ANSI, English-only copy in v1 (except `share bracket`, and the verdict sentence on any card, which are localized) |
| `.cursor/rules/*.mdc` | — | Cursor rules — the public, contributor-facing engineering guardrails (release discipline, surface parity, bracket/schedule invariants) |
| `packages/notifier` | `@claudinho/notifier` | _planned_ — `claudinho watch` daemon |
| `services/gateway` | — | _planned_ — edge API + SSE + cron |

## Commands

- `pnpm install` — install deps
- `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint` — across all packages (`lint` = Biome, no formatter)
- `pnpm -F @claudinho/core test` — operate on a single package
- `pnpm release:qa` — pre-tag surface renderer (see "Release readiness")
- `pnpm canary` — after a build, asks the REAL feed every request form the adapter has (the default scoreboard, one day, the three-day window the live and dated reads use, the bundled bracket's span, the tables), through the adapter, and names the kind of problem: a refused request form or a payload the parsers cannot fully read is red; a block or an outage is neutral and reported as a warning, because the canary saw nothing (a block also ends the run: the provider said stop) (`scripts/espn-canary.mjs`). What it checks is listed in the script's header; it does not replace the parsers' own tests. `.github/workflows/espn-canary.yml` runs it daily; it is unbadged and gates nothing. A red run means the feed changed, not that the build is broken. A fetch method added to the adapter must be asked there (a test fails otherwise).

**Bumping `@biomejs/biome`?** Nothing to do — `biome.json`'s `$schema` points at
`./node_modules/@biomejs/biome/configuration_schema.json`, so it follows the installed version.
Keep that local path: `packages/core/test/biome-schema.test.ts` rejects a pinned URL or a missing
bundled schema. Hand-edit `biome.json` when necessary; `biome migrate` reformats it to tabs.

## Validation scope

- **Prose and agent instructions only:** review the diff, check local links and stated contracts,
  run `git diff --check`, and run the [private-document boundary check](#private-document-boundary-check)
  below. No application build or live-feed QA is needed unless executable
  configuration, commands, package contents, or product behavior also change.
- **Code, dependencies, or executable configuration:** iterate with affected tests, then run
  `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint` before declaring the change ready.
  Build first because CLI/MCP checks use core's generated output. Run the relevant CI smoke and
  packaging checks; MCP contract changes also require the
  [base/head `tools/list` comparison](CONTRIBUTING.md#comparing-mcp-tool-contracts) and
  `pnpm -F @claudinho/mcp smoke:stdio`.
- **User-facing behavior and releases:** also run `pnpm release:qa` after build and inspect the
  output. Keep the "Release readiness" and feature acceptance gates below; a skipped live-feed
  check is not verified behavior.
- Add tests for changed behavior and failure modes. Do not add tests that merely repeat prose or
  implementation details. Once required checks pass, rerun or broaden them only for a subsequent
  change, a failure, or an unresolved concern. After a push, verify CI on that exact SHA.

### Private-document boundary check

Run this from the repository root. It needs only Node and Git, prints the scan results, and exits
nonzero for a tracked private document or a reference to one. `scripts/private-doc-refs.mjs` only
exports helpers; running that file directly does not scan anything.

```bash
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { scanTrackedFiles } from './scripts/private-doc-refs.mjs';
const trackedPrivateFiles = execFileSync('git', ['ls-files', '-z', '--', 'docs/'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const result = scanTrackedFiles(process.cwd());
console.log(JSON.stringify({ ...result, trackedPrivateFiles }, null, 2));
if (result.leaks.length || trackedPrivateFiles.length) process.exitCode = 1;
NODE
```

`pnpm check:pack` also runs the reference scanner and dry-runs package creation. Use it after a
build for packaging validation; a pass without a build does not prove the required artifacts exist.

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
   npm are skipped) and auto-creates the GitHub Release (`gh release create --generate-notes`);
   a second job, `mcp-registry`, then publishes the tag's record to the official MCP Registry.

**The MCP Registry record publishes automatically on every tag.** The `mcp-registry` job in
`publish.yml` runs after the npm publish succeeded, authenticates with GitHub Actions OIDC
(`mcp-publisher login github-oidc` — no token, no device flow; the Registry JWT lives five minutes,
which is why one minted on a laptop always lapsed between releases), publishes
`packages/mcp/server.json`, and verifies the record. It skips a version the Registry already has
(records are immutable; a duplicate is a hard 400), so a re-run is safe. `server.json` is bumped on
every release regardless (the vitest guard pins it to `package.json`), so nothing about the Registry is
manual any more. If the job ever fails (Registry outage), re-run it alone with
`gh run rerun <id> --failed`, or fall back to the manual path from the repo root: `mcp-publisher login
github` (device flow), then `mcp-publisher publish packages/mcp/server.json` — pass the path, since
`mcp-publisher` defaults to `./server.json` in the cwd and ours isn't at the root. The `mcp-publisher`
binary is pinned by version + sha256 in the workflow; bump both together from the Registry's releases.

**MCP-affecting releases** (anything that changes a tool's shape or description) still call for the
`.mcpb`/Smithery decision below — that bundle is a snapshot and the one distribution step left manual.

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
Co-Authored-By: Claude Code (<actual Claude model>) <noreply@anthropic.com>
Co-Authored-By: Cursor (Composer 2.5) <...>
Co-Authored-By: Codex (<actual GPT model>) <noreply@openai.com>
```

Read the model from the current session; never infer it from an example, an older commit, or a
global default that the session may override. Use this `<Agent> (<Model>)` form even when the
coding client suggests a different trailer.

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

- Claudinho exposes a model-independent MCP server; the shipped packages do not call an LLM API.
  An agent-model upgrade concerns the consuming client and these instructions. The AI pundit and
  gateway remain planned features, not migration prerequisites.
- When asked to recommend a GPT-6 model, evaluate `gpt-6-luna` for focused tasks where speed and
  cost matter, `gpt-6.1-sol` for complex work that balances quality with time and cost, and
  `gpt-6-astra` for the most demanding reasoning/review.
  Use the [model-selection guide](https://developers.openai.com/api/docs/guides/model-selection)
  as a starting point, then compare on representative project tasks at the same supported effort
  before tuning effort. The API model pages for
  [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and
  [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) list `low`, `medium`,
  `high`, `xhigh`, and `max`; neither supports `none` or `minimal` in the API.

GPT-6 guidance: [model and prompting recommendations](https://developers.openai.com/api/docs/guides/latest-model)
and [maintaining agent instructions](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
Keep repository-specific contracts and required gates; remove duplicated process instructions when
updating guides. These instructions also serve Claude Code and Cursor contributors.

## Conventions

- Shared domain types live in `@claudinho/core` — never duplicate them.
- Every data vendor implements the `ProviderAdapter` interface — keep providers swappable. An adapter **FETCHES**; it must not interpret. Turning a payload into a domain type happens in `packages/core/src/trust/` and nowhere else (`packages/core/src/trust/espn.ts` is the model), because feed strings reach terminals, share cards, and Claude's context via the hook. Cache readers call the **same** constructors: when the live and cache paths had separate rules, every fix landed on one of them and left the other open — the asymmetry behind most of the security findings in #96. `core/test/trust-parity.test.ts` asserts the two agree. `ProviderAdapter` keeps its plain-array contract. Record-level refusal is local: malformed, duplicate, or truncated records are omitted while readable siblings remain usable and attributed to the provider. (One stated exception, in standings: a payload that holds tables nobody inspected, more children than the bound or a child that carries a `children` value other than an empty list, is refused whole, because no table in it can be shown to be the only one with its key. That is not a record being refused; see the table-key bullet below.) A transport/JSON failure, an unreadable envelope, or a non-empty provider list with no usable records reaches the domain's degraded fallback. Never turn one refused record into a batch-wide outage.
- **Standings expected scope and static fallback compatibility are separate contracts.** `expectedStandingsGroups` says which tables must exist for a provider result to be complete; it never authorizes bundled teams. `standingsFallbackGroups` explicitly says which groups may use the bundled roster. The default World Cup adapter advertises A–L for both. A custom-competition adapter may declare its expected letters but leaves bundled fallback unset, so an outage or omitted expected table returns empty + degraded and can never inject World Cup teams. After a successful open-scope fetch, an absent group means "no such group" only when the provider's INVENTORY of tables is complete; when a table it sent did not become one, an all-tables read returns the tables that were read and says `incomplete` (when none was read it is degraded: there is nothing to qualify), and a key that was not read is degraded, not absent. An all-groups read uses one fallback verdict because `StandingsResult` cannot honestly represent mixed live and static provenance.
- **A table has a key, and the key comes from the raw name.** `GroupStandings.group` is the key a surface selects by: a group letter (`A`), a numbered group (`A1`), a group under a league (`A-B`), or `LEAGUE` for a league's one table; every table but a lettered group also carries the provider's `label`. `parseEspnStandings` derives the key from the RAW name, whole, by an anchored grammar (the sanitized label is a different string: `Group A` plus an invisible character sanitizes to "Group A"). It works in two passes: names first (which children are tables, which keys are claimed twice: such a key belongs to neither), then rows, for at most `MAX_GROUPS` tables whose slot is taken before the first row is parsed. Nothing is skipped: a child either becomes a table or makes the inventory incomplete, and a payload with tables nobody can inspect (more than `MAX_TABLE_CHILDREN` children, or a child that carries a `children` value other than an empty list; a child with no such key is the normal case) is refused whole. A table at the payload's root, beside the children, is not read: it makes the inventory incomplete. A competition written down as having no table (`none`) answers with its own document, a name and a season (`sealSeason`: a year) and no table list or table, and with no root key but the measured ones (`uid`, `id`, `name`, `abbreviation`, `season`, `seasons`, and `children` when it is an empty list): only that is an empty answer. The keys are an allowlist, so an error body that also carries a name and a season is not that document. A league's single table is authorised per competition (`STANDINGS_SHAPE`), never inferred from a payload having one child. Two facts stay apart: `partial` (rows missing from a table) and the inventory (a table missing from the result). And a table key is not a fixture's group: only a lettered group feeds the group map.
- **Text has ROLES, not one universal cleaner.** A human label is prose (no controls, no format characters, no emoji — bounded by display columns AND code points); an identifier is checked against an exact grammar; a timestamp is re-emitted canonically; a flag is **generated** from the nation, never read from a payload or a cache file. That last one is load-bearing: while flags travelled through the text filter, the filter needed an emoji carve-out, and a carve-out without its own grammar is a covert channel (TAG characters, variation selectors and ZWJ each rode through it in turn — a `🏴` plus 42 tag characters is one 2-column glyph spelling a full instruction sentence).
- **A rejection says which KIND it is.** `ParseResult` distinguishes `valid` / `definitive-none` / `malformed` / `ambiguous` / `unresolved`. For per-item market resolution, `valid`, `definitive-none` and `ambiguous` are stable conclusions and may be cached for a TTL; `malformed` and `unresolved` must not become definitive negative market results. A successfully fetched provider batch is different: share its readable prefix for the coalescing TTL even when a sibling row was malformed, because refetching identical bytes cannot heal that row and must not starve valid siblings.
- **Market completeness reaches the renderer.** `cachedMarketSignals` / `marketSignalsFor` return `{ signals, complete }`; default-on annotations, dedicated market commands/tools, share snippets, and JSON/structured output must retain that verdict. A complete empty batch may render "no signal". An incomplete batch renders an explicit unavailable/incomplete notice and carries `marketComplete:false` or `complete:false`; never collapse it to an empty `Map`.
- **A verdict becomes output in ONE place.** When a result says something about itself that changes what a reader may conclude ("not available for this competition" is not "none found"), it states it as a field, and every surface turns that field into a structured key and a sentence through core (`packages/core/src/verdict.ts`): `verdictExtras` for the key, `verdictNotice` for the sentence that REPLACES the body, `verdictQualifiers` for the sentences that QUALIFY it. A surface never forwards the field by hand at an emit site: that is how `share --json` and `markets --json` each dropped a verdict their text carried, and how MCP `data` answered an unsupported competition exactly like an empty one. Adding a verdict means adding it there and declaring its key in the MCP output schemas (`verdictOut`; `incompleteOut` for the standings tools; `partialOut` for `get_next_fixture`, `get_bracket` and `get_share_snippet`; in `packages/mcp/src/server.ts`; the strict schema test refuses an undeclared top-level key). A verdict that replaces the body (`unsupported`: `verdictNotice`) is printed instead of it; one that qualifies what is shown (`verdictQualifiers`, in a fixed order: `incomplete`, tables are missing; `partial`, the knockout window the result was read from was not whole, `partial: { omitted }` with the count of provider records left out when it is known, `partial: {}` when not) is printed with it, on a populated body and an empty one (an empty `next` beside `partial` is "none read", never "eliminated"), and FIRST where a text is cut at a length (a tool's answer, a share card), as a table's `partial` sentence is printed before its table (the standings sites keep the positions they had: CLI `table` after the tables, MCP before). When a result states a replacement, its qualifiers are not printed. A result states `partial` only when its read SAID it was not whole (`fetchMeta`: `complete: false`), never when the adapter said nothing, and it is not `degraded` (the read succeeded); the count is believed only as a positive integer, and the one rule that turns a read's account into the verdict is `partialOfRead`; the cut drops the end of the body, never the tool's footer (the attribution and the disclaimer: `ToolResult.footer`, kept by `toContent`); every emit site of a result that can state one already passes that result through, and a result type that gains its first verdict is wired once, where it is emitted. A table's structured form, with its `partial` verdict, has one mapping too (`tableData` in `packages/core/src/standings.ts`). The share cards that `claudinho share` and `get_share_snippet` hand out are assembled once, in `packages/core/src/share/cards.ts` (title, empty note, run cue, attribution, verdict, and `note`: the qualifying sentences, which both share formatters print before the body whenever it is set); a surface serializes the card and, for MCP, bounds its list. `packages/core/test/verdict.test.ts` guards this by vocabulary (a surface's code never spells `unsupported`, `incomplete:` or `partial:` outside the MCP schema, a verdict's sentence or i18n key, a card's empty note or run cue, or a table's `partial` key); it catches a copy, not every way to write one, so the rule is still yours to keep.
- **A window is composed of the requests the provider accepts.** ESPN refuses date ranges (`dates=A-B`, since Oct 2026) and serves one day or one calendar month. `EspnAdapter.fetchWindow` asks a day at a time (up to three days) or a month at a time (longer; more than three months is refused unasked), sends the parts together, and settles every one before it answers, so a throttle that arrives after a sibling's quick failure has armed the cooldown. It returns ONE result with one account: any part's failure fails the window (a throttle wins: the one the adapter retains, whose deadline is latest counted from when each was received); a part whose ENVELOPE cannot be read is a failed part, whatever its siblings hold (the unreadable-envelope rule above is asked of each response); a part that filled the request's `limit` (the provider returns a silent chronological prefix) fails it too; a refused RECORD, or a fixture in two parts (compared before a month is narrowed to the window; the first copy counts), leaves it `complete: false` with the readable rest usable, and the "no readable record" rule is asked of the whole window, not of each part. Its account states `seasons` (every distinct season the parts stated, in the order asked; empty is "none stated") and `omitted` (the records that made it not whole: the parser's count per part, a refused record, a duplicate, one beyond the bound, plus each second copy across parts; 0 exactly when `complete`; absent on a single read that filled its limit, whose tail nobody can count). The count is over the RESPONSES the window was composed from, a month response whole: a record refused outside the span counts (it already makes `complete` false, and a refused record often has no readable date), so it bounds what the span may be missing, and every sentence built on it says "may be incomplete". A day response states the season of the DATE asked, and each competition turns on its own date (June 1, July 1, January 1, measured), so a window's parts can state two seasons. Two season rules, kept two: the WINDOW states the season its stating parts agree on (a part that states none does not veto); DISCOVERY states one only when every month states the same. Two seasons in a window are then a failure when it is asked strictly (the default, and every caller that merges the bundle or keeps a slice: an absent season would let the bundle apply or a slice of another edition stand), and a composed answer with no `season` and both in `seasons` when it is asked `acrossSeasons`, which only the live read does (`getLiveRead`: it keeps the matches in play and merges nothing, and a refusal there was three requests spent on a verdict nobody can act on). The dated read on a turn day is still refused. A fixture's day is the PROVIDER's (US/Eastern, measured; `bucketDay`), which is what the month filter keeps by and what the canary checks on every dated response. An incomplete answer cannot prove a fixture is gone: a caller that keeps a previous answer (the refresher's knockout slice, and off the bundle its schedule slice) must not let it erase one. It keeps what the answer did not READ (`mentioned`: everything the answer read, also a tie it set aside as postponed or played). The knockout slice does so only while both seasons are known to be the same; with either unknown the slice stands as it was and the read counts as a failed attempt. The schedule slice does so unless the two seasons are known to DIFFER, because there an unknown season is an ordinary state (a discovery whose span touches two seasons states none); only an answer known to be another season replaces it (`applyDiscovery`). The season it then stores is a claim about every entry, so a union that KEPT entries stores the answer's season only when the two were already known to be the same, and none otherwise: a kept entry is never given a season it was not read under (an answer of "another" season could then delete it). The knockout-facing interactive reads (`next`, `bracket`, their share cards; CLI text and `--json`, MCP text and `data`) carry the window's `complete: false` as the `partial` verdict (see the verdict bullet); the other interactive reads (`today`, `live`, `match`, `markets <team>` through `marketFixtureForTeam`, and their MCP and share twins) still drop it, until the partial-read verdict reaches them too.
- **A refresher decides under the lock, and a throttle always has somewhere to be written.** `runRefresh` takes a first look at the cache without the lock, and that look may only decide NOT to ask; a decision to ask the provider is made from the state read after `claimLock` (between the two, another refresher can have published a fresh slice or a backoff). A provider throttle (403/429) goes into the snapshot under that lock, and into the scope's NOTE (`backoffNotePath`: lock-free, atomic, never deleted, an expired one is just not believed) whenever a reader would not find it in the snapshot: the lock was taken, the publish was refused or its write failed (a publish that throws is one that did not happen), the snapshot cannot be read; it used to be dropped. A throttle counts as written only when a reader will find it, in the note AND in the snapshot: after its attempt to publish, refused, failed or not, each writer (a command's `persistBackoff`, the refresher) asks `ensureBackoffVisible`, which writes the note unless the backoff in effect is already at least as late (`writeBackoffNote` reads the note back). The backoff in effect is the later BELIEVED deadline of the snapshot's and the note's: every reader asks `backoffInEffect`, at the time it is then: the hot-path triggers (LAST, so the note is looked at only once a refresh would otherwise be started), the refresher when it decides, again before its second lane, and at publish, and a command arming its adapter. Every writer keeps the later believed one, comparing with `backoffInEffect` (the note included), never with the snapshot alone. `believedDeadline` is the one rule for a deadline: in the future and at most 30 minutes ahead; a value that is not believed neither beats nor hides a real one. Every file the CLI keeps (the snapshot, the note, the lock, the market cache, the run counter) is read through one descriptor, bounded and without waiting (`lookAtSmallFile`/`readSmallFile` in `paths.ts`); the only reads by path are the user's settings file and standard input, pinned by `cache-reads.test.ts`. A lock that vanished while a claimer looked at it is not removed (the claimer creates it once more); a stale one is taken over. Not closed, and stated in `claimLock`: two stealers of the same stale lock, and a lease lost while its owner still runs (the ownership check before a publish is not fencing).
- **Off the bundled competition the refresher discovers, then polls only when a match can be in play.** The bundled schedule gates live polling for the World Cup; nothing did for any other competition, so the refresher polled around the clock. There a cycle is now: DISCOVERY if due (`getScheduleAhead`: yesterday to 14 days ahead in provider days, each calendar month its own window, so two months that state two seasons are two answers, and the discovery states a season only when every month states the same one; the "no readable record" rule is asked of the whole discovery, not of each month: a month whose list held only records nobody could read read nothing, which leaves the answer incomplete while another month read something, and fails it when none did; once an hour, 5 minutes doubling to an hour while it fails, anchored on an attempt that is written BEFORE its request); the backoff again; the GATE on the slice as it now is; a live read if the gate is open and the live slice is at least 12 seconds old; then one final publish. A throttle is never a failed discovery, however short its wait, and every throttle gets the same five-minute floor before the provider is asked again, on both paths (`backoffToPublish`). The gate is open only for a discovered fixture that is on (not postponed, cancelled or finished) inside its 140 minutes, a match SEEN in play that no whole read has yet seen to be over (at most six hours past its kickoff), or one probe owed after a failed discovery. Every rule about the cache's `schedule` slice is a pure function in `packages/cli/src/scheduleSlice.ts`, and what is read back from the file is believed only within bounds (`scheduleView` is the one reader of everything in the slice but its display records: the index, both stamps, `failures`, `complete`, `inPlayUntil`, `probe`, the season; an index is whole or absent, never a prefix, an entry further ahead than discovery reads is not believed (`SCHEDULE_HORIZON_MS`), and its entries have one constructor in core's trust module; the display records are sealed where they are used, like every cached match). `refreshWanted` is the ONE trigger for the statusline and the hook: never during a backoff, with a snapshot or without one, and never for a source nobody can ask once its idle snapshot exists. The statusline reads the slice's display records for a countdown and its gate (never the probe) for `live · syncing…`, and names no record that is postponed, cancelled or finished (`hasLiveWindow`, the index's own rule); `⚽ —` is the line for "nothing known". Detection is best effort and says so: it needs an invocation, a usable answer and no backoff. On the bundled competition nothing changes (after the one cycle that rebuilds a cache written in the older format), and the knockout `fixtures` slice stays the bundle's.
- **Bound the WORK, not just the output.** Collections are sliced before the per-record work, never after (`takeBounded`), and a surface reports `total`/`shown`/`truncated` from ONE `BoundedList` rather than recomputing counts per call site.
- Static data (schedule, groups, flags) ships bundled in clients; only **live state** hits the network (and, for a competition the bundle does not describe, its schedule ahead: there is no static one to ship).
- **Standings come from the provider's standings feed, NOT computed from a match window.** The bundled schedule is a resultless skeleton, and clients only fetch a ±1-day live window — so deriving a table from those matches yields a *wrong, partial* table mid-tournament (this was a real bug: groups not playing that day read all-zeros). `table`/`get_standings`/`standings://` go through core `getStandings` → optional `adapter.fetchStandings()` (authoritative cumulative table from ESPN's standings endpoint — the SAME endpoint `fetchGroupMap` already hits, so no new egress). It **fails closed** with no attribution: the default World Cup scope may show a static roster-at-zero, while a competition with no compatible bundled roster returns empty + degraded. `computeStandings` (match-derived) remains for the compatible static fallback only.
- **`CLAUDINHO_COMPETITION` is a deliberate keeper — do not remove it.** It points the live fetch at another ESPN competition (e.g. `fifa.friendly`) and is woven through both the live fetch and the **hot-path cache key** (the cache is competition-keyed). It looks dormant during the World Cup but is load-bearing — it's the seam for following other tournaments.
- **The competition is decided ONCE, at the edge, and then travels as a value.** `resolveCompetition` is called in exactly two places: the CLI's option resolution (`packages/cli/src/config.ts` → `cfg.competition`) and the MCP server where it builds a request's adapter (`resolveAdapter`). Below the edge the adapter STATES the competition it serves (`ProviderAdapter.competition`, required) and every function asks the adapter or the config — never the environment, and never a default argument. Twenty-four call sites used to re-resolve it mid-request. `packages/core/test/selection-identity.test.ts` fails on a call anywhere else, or on one with no argument.
- **A team's identity is the provider's id; its code is a label.** `Team.id` is the provider's stable id, namespaced (`espn:359`), the same for a club in every competition, present on a team read from a feed (and read back from the cache) and absent on the bundled skeleton. `Team.code` is a display label: it is never matched against a shape, and it does not identify a team (a real club abbreviates to `O&M`, and `CAR` is two clubs in one competition). The places that still SELECT a team by its letters (`fixturesByTeam`, the statusline and hook team filter, the team argument) are World Cup behaviour on its way out, not a pattern to copy; new code compares ids. `sealTeam` is the one `Team` constructor and `sameTeam` the one "can these play each other" comparison (the same id, OR the same code and name — an id only ever adds a refusal).
- **What a provider says ABOUT a response belongs to that response.** The season a response answered for rides on the returned array (`attachFetchMeta` / `fetchMeta`, `packages/core/src/adapters/meta.ts`), never on an adapter field: a field is shared by every call in flight, so the second call to finish overwrites what the first was told (`lastError` is "best-effort under concurrency" for that reason). A season is never part of what a request selects, and the cache-only hot path never claims to know that a newer one exists.
- **The bundled schedule is a resultless skeleton.** No scores/status, no confirmed nations in knockout slots. `sanitizeBundledFixture` restores topology placeholders; `gen:schedule` **fails loud** if any knockout fixture carries a real nation flag. Advancement comes only from the live overlay — clients never invent it from static JSON.
- **The live fixture's pairing wins over the static topology's winner-refs.** `buildBracketView`/`resolveSlot` resolve a knockout slot from the ESPN fixture ESPN actually serves for that match (`liveParticipant`), and only fall back to projecting a winner from the bundled `winner`/`loser` topology refs when that fixture is **absent from the merged set** (degraded feed). This is deliberate: the bundled winner-ref indices (parsed from ESPN's placeholder slot labels at generation time) do **not** reliably correspond to ESPN's actual R32→R16 feeder assignment, so projecting from them rendered **wrong R16 pairings** (v0.8.16 P1: "Paraguay vs Mexico" instead of the real ties). The topology is now structure/labels + a degraded-only fallback; the pairing is ESPN's. Guarded by the `P1 GUARD` case in `bracket-resolve.test.ts` (feeder ref disagrees with the live fixture → live wins).
- **Knockout/team-facing surfaces MUST live-resolve — never read the skeleton.** Because the bundle's knockout slots are 🏳️ placeholders (above), *every* team-facing surface must reach the live overlay (`getBracket` / `getNextFixtureForTeam`) to show real nations; a surface that reads the static bundle is **silently** blind to a confirmed tie (no crash, just a stale placeholder). This is Claudinho's most recurring bug: the *same* root cause shipped as v0.8.2 (R32 seeds), v0.8.6 (third-place slots), and v0.8.7 (next fixture) — three hotfixes, three different surfaces. **The surface list (keep in sync):** CLI `bracket` · `next` · `share bracket` · `share next`; MCP `get_bracket` · `get_next_fixture` · `get_share_snippet{bracket,next}`. The **statusline** can't fetch on the hot path (<150ms, cache-only), so it live-resolves *indirectly*: the cold-path refresher caches resolved knockout fixtures (`getKnockoutFixtures` → `CacheState.fixtures`) and the statusline reads them, **failing closed to `⚽ —`** (never a 🏳️ placeholder leak) when the cache lacks the pairing (v0.8.8; v0.8.9 adds empty-cache short TTL at phase boundaries and drops unresolved matchups from `live · syncing…`). **`cmdPrompt` and `cmdHook`** both spawn fixtures refresh in knockout phase. **Executable guard:** `packages/{cli,mcp}/test/knockout-surface-coverage.test.ts` pins one fake resolved tie (MEX vs ECU) and asserts every surface renders the real nations (the statusline from a seeded cache). **Add any new team-facing surface to that test** (and to `.cursor/rules/surface-parity.mdc`). **Deliberate exception — the MCP `fixtures://{date}` resource:** it is labeled "Static fixture list" and serves the bundled skeleton by design (a resource URI carries no timezone and gets no live overlay, so knockout slots stay 🏳️ placeholders there); agents needing live-resolved pairings use `get_today`/`get_bracket`. It is the only team-facing surface allowed to read the skeleton directly.
- Market signals use a separate `MarketProvider` interface (not `ProviderAdapter`). The Polymarket event slug is **derived per fixture** (`fifwc-{home}-{away}-{date}`), so most matches resolve with no mapping; `mapping.2026.json` holds slug **overrides only** (ships empty) and validation **fails closed**. Market-facing copy is English-only in v1 (the approved legal copy bank lives in `core/src/markets/format.ts`). Two derivation quirks (both fail-closed, both `release:qa`-tripwired): Polymarket slugs by the **host-local date** (try the UTC date + prior day — `deriveEventSlugs`), and it abbreviates some nations differently from their FIFA code (`POLYMARKET_TOKEN` alias table, e.g. `NED→nld`, `COD→cdr` — used by both slug derivation and outcome-market matching). Candidate-slug fetches honor the enrichment **deadline between candidates** (not just between fixtures), so alias fan-out (up to 8 slugs) never blocks default-on rendering.
- **The statusline and hook are English-only by design** — a deliberate carve-out from the four-locale rule. Both are single-line, latency-bound ambient surfaces whose few fixed tokens ("live · syncing…", "in 2d 4h", the hook's context label) stay EN; the interactive commands localize, the two ambient surfaces don't.
- **Shareable snippets** (`claudinho share`, the MCP `get_share_snippet` tool, `core/src/share`) are pure, deterministic **plain-text** artifacts (no ANSI — they get pasted): English-only copy in v1 **except `share bracket`** (localized en/es/pt/fr via `ShareBracketOptions.locale`; and except the sentences a card prints for a verdict ("Not available for this competition yet"; "Some tables could not be read"; "Fixture data may be incomplete", the `note` on a next or bracket card), which is the same localized sentence on every surface: a card builder takes the reader's language for it; the non-affiliation disclaimer + hashtag stay EN as fixed strings), market lines reuse the approved copy bank verbatim (`marketBlock`/`marketLine`, never hand-composed), and the non-affiliation disclaimer is **non-optional** (only the hashtag and install cue are toggleable). They use the same reliable market gate as `today`/`match` and are **never** on the statusline/hook hot path. **`share table [KEY]`** produces a standings card for one table (a group letter, or `A1`, `A-B`, `LEAGUE`) or, with no key, for every table (and then says so when tables are missing) — facts + emoji flags only, **no market line**; a degraded (roster-only) card carries an explicit not-live notice so it can't paste as real.
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
findings **P1/P2/P3**. Apply each item to the behavior and contracts affected by the change;
use "Validation scope" for the required checks.

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

## Change discipline

**Changing a shared rule**

- **Put the rule where every path reaches it, then delete the other copy.** Live and
  cache paths must use the same rule.
- **Search for siblings before calling a class closed:** other timestamps, the hook
  beside the statusline, cache constructors beside provider constructors.

**Tests**

- **Make a new regression test fail before trusting it.** Temporarily revert the rule
  and confirm red, then restore it. Preserve unrelated edits.
- **Pin the CALL, not just the function.** For a call-site regression, temporarily remove
  the call and confirm red, then restore it.
- **Never assert wall-clock time.** Assert an observable consequence: put a valid item
  just past the cap and prove it is never reached.
- **Escape invisible characters in fixtures** so their meaning survives copying and review.

**Before saying it is done**

- **Run the checks required by "Validation scope" AND read the output.**
- **For a refactor affecting feed output, diff real-feed output against the base branch**,
  key order included. Report if the feed prevents verification.
- **Wait for CI on the SHA you pushed.** `gh run watch` on a queued run returns
  success; check `headSha` matches.

## Definition of Done (per user-facing feature, not per PR)

Before implementing a user-facing feature, write 3–5 acceptance criteria **from the
user's point of view**, plus an explicit statement of what the change does NOT cover.
Keep them in the PR description before the first commit; if no PR exists yet, draft that
description locally and use it when opening the PR. A feature spanning several PRs must
meet the same criteria across the whole feature. Verify them on a real terminal:

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

Every release carries real toil (a multi-file version bump, and for MCP-affecting changes a
`.mcpb`/Smithery re-publish). Fewer, fuller releases cut that directly. When unsure, accumulate.

## Don't

- Don't put API keys in client packages — keys live **only** in the gateway.
- Don't block the statusline hot path on the network — read from the local cache (<150ms).
- Don't cite anything under `docs/` from a tracked file (code comments, Cursor rules, templates, READMEs). That folder is maintainer-private and gitignored; a public reference leaks a private path and goes stale when the private tree changes. `scripts/check-pack.mjs` (run in CI) fails on any `docs/<name>` reference.
