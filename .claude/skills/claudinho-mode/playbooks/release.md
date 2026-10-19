# Playbook: release

The version bump, the gate, the live pass, and the watch of the publish. The tag and the publish are the
maintainer's: never a tag or a publish by an agent.

## Steps

0. The release branch and its own worktree, never the main checkout: `git worktree add -b <branch> <path> main`;
   every later step runs in `<path>`. Then `pnpm install --frozen-lockfile` in `<path>`, before anything is built,
   tested or gated there (a worktree git just made has no `node_modules`).
1. The batch: what is on main since the last tag, which of it is user-facing and which MCP-affecting (a tool's shape
   or description). A hotfix is live data correctness only (AGENTS.md "Release cadence").
2. The version bump on the release branch, in the three `package.json` files (`packages/cli/package.json`,
   `packages/mcp/package.json`, `packages/core/package.json`), `packages/mcp/mcpb/manifest.json` and
   `packages/mcp/server.json` (AGENTS.md "Releasing"); the guards `manifest.test.ts` and `server.test.ts` fail on a
   drift.
3. Run the gate below and read it step by step.
4. `pnpm release:qa` after the build, read whole: every surface, both timezones, the four locales, the club pass, the
   tripwires. A SKIP is not a pass; a feed outage is reported as one.
5. For an MCP-affecting release: the base and head `tools/list` compared (CONTRIBUTING.md "Comparing MCP tool
   contracts").
6. Commit with the trailer. The first push is a plain `git push -u origin <branch>`; then
   `gh pr create --base main --head <branch> --title "<subject>" --body-file <file>` (the body ends with the
   trailers of the agents whose commits the branch carries and the generated-with line the coding client asks for);
   then the push line below, which pushes nothing (the remote already has the head) and reads CI per job on it.
7. Before the merge is recommended: the review rounds on the release head
   (`.claude/skills/claudinho-mode/playbooks/review-round.md`, then
   `.claude/skills/claudinho-mode/playbooks/confirmation-round.md`) and the review ledger's merge check passing,
   with the confirmed SHA held.
8. The merge is the maintainer's: `gh pr view <n> --json headRefOid` read against the held SHA (a different head
   goes back to the confirmation round), then `gh pr merge <n> --squash --match-head-commit <held sha>`.
9. The tag is the maintainer's, on the commit step 8's squash made on `main`, never on the release branch's head
   (a bare `git tag vX.Y.Z` tags `HEAD`, the branch's commit in this worktree; the squash commit is absent here
   until a fetch), pushed by them, as AGENTS.md "Releasing" step 3 gives it:

   ```bash
   git fetch origin +refs/heads/main:refs/remotes/origin/main &&
     sha=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid) &&
     git merge-base --is-ancestor "$sha" origin/main &&
     git tag vX.Y.Z "$sha" && git push origin vX.Y.Z
   ```

   The fetch names its refspec, so it refreshes `origin/main` whatever the clone's `remote.origin.fetch` holds.
   Each command runs only when the one before it succeeded. When the chain stops before `git tag` (the fetch or `gh`
   failed, the PR is not merged, or `main` does not hold its merge commit), nothing is tagged: check that
   `gh pr view <n> --json state` says `MERGED`, then run the block again. `publish.yml` gates on build, typecheck,
   test, lint and tag == version, not on the tag being on `main`, so a tag on the branch's head would still publish,
   with a GitHub Release on a commit `main` does not contain. Then watch the publish workflow on the tag
   (`.github/workflows/publish.yml`): its two jobs, `publish` and `mcp-registry`, the run found with
   `gh run list --workflow publish.yml` and read per job with `gh run view <id> --json jobs`; the npm versions, the
   GitHub Release and the Registry record checked afterwards.
10. The `.mcpb`/Smithery decision for an MCP-affecting release: the bundle is a snapshot; rebuilt with
    `pnpm -F @claudinho/mcp build:mcpb`, audited at its root, published by the maintainer.
11. The maintainer's machine on the new version: AGENTS.md "Releasing" step 4, as written there (the CLI with the
    installer that owns the `claudinho` that runs, the plugin with its read-back on `main`'s version and a reload,
    the MCP server's installed copies if any), each installed version read back with the command step 4 names. None
    of it updates by default.

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

The release branch's first push is a plain `git push -u origin <branch>` (CI runs on pull requests and on main
alone: before the pull request there is no run, and the watch would poll for one until its deadline), then
`gh pr create --base main --head <branch> --title "<subject>" --body-file <file>`, then this line, which reads the
head's CI per job; every later push is this line.

## Evidence

- The gate's log directory, the `pnpm release:qa` output with its counts, the `tools/list` comparison, the publish
  run's per-job result, the npm, Release and Registry checks, the held SHA and the merge commit, and the CLI and
  plugin versions read back on the maintainer's machine.
- The release commit ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use.
- Kept privately, by role: the release log entry in the private procedure.

## Reply

A status ends Running, Blocked on you (the tag, the publish, the `.mcpb` decision) or Done. The run ends with a
numbered "What I need from you": per item the context, the options, the recommendation and the default.

## Ask

- Merge the release PR at the confirmed head, then push the tag on the merge commit `main` carries (step 9).
- The `.mcpb`/Smithery re-publish, for an MCP-affecting release.
- Anything `pnpm release:qa` showed that the maintainer should eyeball before the tag.
