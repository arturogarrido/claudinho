# Playbook: release

The version bump, the gate, the live pass, and the watch of the publish. The tag and the publish are the
maintainer's: never a tag or a publish by an agent.

## Steps

1. The batch: what is on main since the last tag, which of it is user-facing and which MCP-affecting (a tool's shape
   or description). A hotfix is live data correctness only (AGENTS.md "Release cadence").
2. The version bump on a release branch, in the three `package.json` files (`packages/cli/package.json`,
   `packages/mcp/package.json`, `packages/core/package.json`), `packages/mcp/mcpb/manifest.json` and
   `packages/mcp/server.json` (AGENTS.md "Releasing"); the guards `manifest.test.ts` and `server.test.ts` fail on a
   drift.
3. Run the gate below and read it step by step.
4. `pnpm release:qa` after the build, read whole: every surface, both timezones, the four locales, the club pass, the
   tripwires. A SKIP is not a pass; a feed outage is reported as one.
5. For an MCP-affecting release: the base and head `tools/list` compared (CONTRIBUTING.md "Comparing MCP tool
   contracts").
6. Commit with the trailer, push with the push line below, CI per job on the pushed SHA, the PR merged by the
   maintainer.
7. The tag is the maintainer's (`git tag vX.Y.Z` on the release commit, pushed by them). Then watch the publish
   workflow on the tag (`.github/workflows/publish.yml`): its two jobs, `publish` and `mcp-registry`, read per job
   with `gh run list --workflow publish.yml` and `gh run view <id>`; the npm versions, the GitHub Release and the
   Registry record checked afterwards.
8. The `.mcpb`/Smithery decision for an MCP-affecting release: the bundle is a snapshot; rebuilt with
   `pnpm -F @claudinho/mcp build:mcpb`, audited at its root, published by the maintainer.
9. The post-release chore: `npm i -g @claudinho/cli@latest`.

## Gate

```
bash scripts/gate.sh
```

Every step's verdict read on the bumped tree; the gate does not run `pnpm release:qa` (step 4) and does not replace
CI's Node 20, Windows and macOS jobs (the push watch).

## Push

```
bash scripts/push-and-watch.sh <branch>
```

The release branch's head, its per-job CI read before the maintainer merges and tags.

## Evidence

- The gate's log directory, the `pnpm release:qa` output with its counts, the `tools/list` comparison, the publish
  run's per-job result, the npm, Release and Registry checks.
- The release commit ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use.
- Kept privately, by role: the release log entry in the private procedure.

## Reply

A status ends Running, Blocked on you (the tag, the publish, the `.mcpb` decision) or Done. The run ends with a
numbered "What I need from you": per item the context, the options, the recommendation and the default.

## Ask

- Merge the release PR and push the tag on the release commit.
- The `.mcpb`/Smithery re-publish, for an MCP-affecting release.
- Anything `pnpm release:qa` showed that the maintainer should eyeball before the tag.
