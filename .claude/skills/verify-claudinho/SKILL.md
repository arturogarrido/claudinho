---
name: verify-claudinho
description: Drive one surface of the built Claudinho binary in isolation, offline by default, and keep the evidence. Use it to verify a change on the real CLI, the MCP server over stdio, the statusline or the hook without touching the operator's config, cache or network.
---

# verify-claudinho

The inner loop for an agent that changed Claudinho: one command per surface, run on the REAL built binary in an
environment built from scratch, offline unless told otherwise, with the evidence of every child kept. The live
pass stays `pnpm release:qa` (a person, the real feed); this skill never replaces it.

## Launch

`pnpm -r build` from the repository root. A CLI and a stdio server have no server to keep alive: there is nothing
to start and nothing to stop.

## Doctor

```
node scripts/verify.mjs doctor --json
```

Checks, each printed ok or FAIL, the exit nonzero on any FAIL: Node at or above the engines floor; the CLI and MCP
dists present and the CLI dist's `--version` equal to `packages/cli/package.json`; a temporary config directory made
and removed; a temporary cache directory made, written and removed (the harness's own, never the operator's);
`CLAUDINHO_COMPETITION` and `CLAUDINHO_TEAM` REPORTED as set or unset (a report: the children never see them). The
feed is not asked.

## Drive

Every child the control CLI starts (the bootstrap `follow`, the main command, the `--json` twin, the capture, the MCP
server, the hook) runs with an environment BUILT FROM SCRATCH: a temporary HOME, absolute temporary
`XDG_CONFIG_HOME` and `XDG_CACHE_HOME`, `TZ=UTC`, `--lang en` unless the scenario passes `--lang`, `CLAUDINHO_NO_STAR=1`,
colour off except under `capture`, the mode's preload loaded in the child through `NODE_OPTIONS`, every spawn the
product asks for recorded and never started, every fetch attempt recorded. The mode is `--offline` (the default:
every fetch fails at once with a network error, so the surface renders its degraded path), `--replay <corpus>` (a
recorded feed; an unrecorded URL fails the run) or `--live` (the provider, for a person on purpose; never an agent
mid-task). `--env KEY=VALUE` sets only a scenario key (`CLAUDINHO_COMPETITION`, `CLAUDINHO_TEAM`, `CLAUDINHO_SOURCE`,
`CLAUDINHO_MARKETS_SOURCE`, `LANG`, `TZ`); every other key is refused.

```
node scripts/verify.mjs run --offline --follow premier-league --twin --json -- today 2026-10-07
node scripts/verify.mjs mcp --offline --follow premier-league --json get_today '{"date":"2026-10-07"}'
node scripts/verify.mjs mcp --json --list
node scripts/verify.mjs seed club --slug eng.1 --cache <dir> --json
node scripts/verify.mjs prompt --seed club --slug eng.1 --follow premier-league --json
node scripts/verify.mjs hook --seed club --slug eng.1 --follow premier-league --json
node scripts/verify.mjs replay <corpus> --follow premier-league --twin --json -- today 2026-10-07
node scripts/verify.mjs capture <label> --follow premier-league --json -- today 2026-10-07
```

`run` refuses before any child: the install commands (`init`, `init-statusline`, `init-hook`,
`init-cursor-statusline`, `claude`, `cursor`), `star`, `_refresh` and any `--copy` (they write the operator's
settings or the clipboard, outside the sandbox). `--follow --team` is not offered (pinning a club reads the
provider). Every child has a deadline (`--timeout <s>`, 60 by default; the MCP session 30) and is killed and reaped
when it passes, its partial evidence kept.

The feature map, one file per surface with how to drive it and what proves it, lives at
`.claude/skills/verify-claudinho/features/` (five surfaces so far: `today`, `live`, `next`, `table`, `statusline`,
the hook on the statusline's file). Every `offline:` line of those files is run by
`packages/core/test/verify-cli.test.ts`; a `replay:` line names what a recorded feed must prove (the next PR).

## Evidence

Under `--out <dir>` (default: a timestamped directory under the temporary root, printed by every command): per
phase `<label>.<phase>.txt` (stdout), `.err` (stderr) and `.exit`; `<label>.spawns` (one JSON line per spawn the
product asked for); `<label>.fetches` (one JSON line per fetch attempt: the URL, the mode and the outcome `blocked`,
`replayed:raw`, `replayed:synthetic`, `miss`, `malformed`, `live:<status>` or `live:error`); `<label>.result.json`
(the aggregate: `ok`, the mode, every phase's exit, the environment's keys, the paths). `ok` is false on any
phase's nonzero exit, any miss or malformed recording, a timeout, or an MCP failure; the child's own exit is kept
beside it. A capture writes `<label>.ansi` and `<label>.txt` from the combined pty stream. The PNG card is the
maintainer's private demo tool, not this skill's.

## Cleanup

The temporary HOME, config and cache directories are removed when the command ends (`--keep` keeps them). The
evidence directory is never removed.

## Selecting the evidence for a change

| Changed behavior | The evidence to select |
|---|---|
| Provider parsing or a trust boundary | the recorded payloads and hostile inputs in `packages/core/test/`, the live and cache parity (AGENTS.md "Conventions", the trust bullets) |
| A verdict or its presentation | the CLI text and `--json` twin, the MCP text and `data`, the share cards, a qualifier surviving a cut (`run --twin`, `mcp`; the verdict bullet) |
| Selection, configuration, the cache | precedence (`--env CLAUDINHO_COMPETITION` against `--follow`), refused inputs, cold, stale and partial state, the next call, concurrency (`run`, `seed`, `prompt`; the selection bullet) |
| The statusline or the hook | the line, the spawn count, no network and no market work (`prompt`, `hook` on a seed) |
| An MCP contract | the base and head `tools/list` (`mcp --list` on both), the stdio smoke |
| Distribution or a release | the packaging contents, the manifests, `pnpm release:qa` (a person, live) |

## Replay and live are two different things

A provider outage leaves a live check unverified. A green replay proves nothing about today's feed. Live ESPN is
the canary and `pnpm release:qa`, single-flight. An agent mid-task uses `--offline` or `--replay`.

## Validation scope is unchanged

A prose-only change gains no build and no drive (AGENTS.md "Validation scope").
