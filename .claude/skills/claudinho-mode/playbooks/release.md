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
6. Commit with the trailer, then the first push and the pull request (the Push section), and CI per job on the
   pushed SHA.
7. Before the merge is recommended: the review rounds on the release head
   (`.claude/skills/claudinho-mode/playbooks/review-round.md`, then
   `.claude/skills/claudinho-mode/playbooks/confirmation-round.md`) and the review ledger's merge check passing,
   with the confirmed SHA held.
8. The merge is the maintainer's: `gh pr view <n> --json headRefOid` read against the held SHA (a different head
   goes back to the confirmation round), then `gh pr merge <n> --squash --match-head-commit <held sha>`.
9. The tag is the maintainer's (`git tag vX.Y.Z` on the release commit, pushed by them). Then watch the publish
   workflow on the tag (`.github/workflows/publish.yml`): its two jobs, `publish` and `mcp-registry`, the run found
   with `gh run list --workflow publish.yml` and read per job with `gh run view <id> --json jobs`; the npm versions,
   the GitHub Release and the Registry record checked afterwards.
10. The `.mcpb`/Smithery decision for an MCP-affecting release: the bundle is a snapshot; rebuilt with
    `pnpm -F @claudinho/mcp build:mcpb`, audited at its root, published by the maintainer.
11. The post-release chore: `npm i -g @claudinho/cli@latest`.

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

The release branch's first push is `bash scripts/push-and-watch.sh <branch> --allow-no-run` (no run to watch before
its pull request), then `gh pr create --base main --head <branch> --title "<subject>" --body-file <file>`, then this
line, which reads the head's CI per job; every later push is this line.

## Evidence

- The gate's log directory, the `pnpm release:qa` output with its counts, the `tools/list` comparison, the publish
  run's per-job result, the npm, Release and Registry checks, the held SHA and the merge commit.
- The release commit ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use.
- Kept privately, by role: the release log entry in the private procedure.

## Reply

A status ends Running, Blocked on you (the tag, the publish, the `.mcpb` decision) or Done. The run ends with a
numbered "What I need from you": per item the context, the options, the recommendation and the default.

## Ask

- Merge the release PR at the confirmed head and push the tag on the release commit.
- The `.mcpb`/Smithery re-publish, for an MCP-affecting release.
- Anything `pnpm release:qa` showed that the maintainer should eyeball before the tag.
