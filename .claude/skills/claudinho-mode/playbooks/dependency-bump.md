# Playbook: dependency bump

A Dependabot PR, an advisory, or a hand-made bump. The title is not the change: the lockfile is.

## Steps

0. The branch. A hand-made bump gets its own branch and worktree, never the main checkout:
   `git worktree add -b <branch> <path> main`; the bump is made there and every later step runs in `<path>`. A
   Dependabot-made PR already has its branch and its pull request: its path through the push and the pull request
   starts at the watch (step 8), on a checkout of its branch; steps 1 to 6 run there as for any head.
1. Read the lockfile delta, not the PR title: `git diff <base> <head> -- pnpm-lock.yaml`, every package that moved
   listed with its old and new version, runtime and dev apart. A runtime bump can move a whole subtree.
2. Check the PR's CI date: a green run older than the newest advisory is stale; run the checks again on the head.
3. The audit, its exit captured without a pipe: `pnpm audit --prod; echo "exit $?"` (a pipe reports the status of
   its last command, not the audit's).
4. For a runtime dependency (the MCP SDK and what it loads): the modules that changed in its dist, walked from the
   two SDK entry points the server imports (`server/mcp.js`, `server/stdio.js`), named reachable or unreachable;
   and `tools/list` compared by bytes, base against head (AGENTS.md "Validation scope", CONTRIBUTING.md "Comparing
   MCP tool contracts"), with `pnpm -F @claudinho/mcp smoke:stdio`.
5. Two bumps open at once are merged in simulation before either lands, heads `<a>` and `<b>`:
   `git merge-tree --write-tree <a> <b>` (it prints a tree), then
   `git commit-tree <tree> -p <a> -p <b> -m "simulated pair"` (a commit no ref names), then
   `git worktree add --detach <path> <commit>`, and the gate below there. A conflict-free merge can still be a
   broken lockfile: install it frozen. After the first lands, the second is rebased and gated again.
6. Run the gate below on each head, and on the simulated pair.
7. A hand-made bump: commit with the trailer; the first push is a plain `git push -u origin <branch>`; then
   `gh pr create --base main --head <branch> --title "<subject>" --body-file <file>` (the body ends with the
   trailers of the agents whose commits the branch carries and the generated-with line the coding client asks for).
8. The watch, per job: `bash scripts/push-and-watch.sh <branch>` on a checkout of the branch (it pushes nothing when
   the remote already has the head, and reads CI per job on it), or `gh run view <run-id> --json jobs` for the CI run
   whose head SHA is the PR's. Never `gh run list --commit <sha>`: it lists runs, not jobs.
9. The `.mcpb` bundle embeds its runtime dependencies: an advisory whose patch is not in the embedded set calls for
   a rebuild and an audit at the bundle root (AGENTS.md "Releasing").
10. Before any merge is recommended: the review rounds on the head
    (`.claude/skills/claudinho-mode/playbooks/review-round.md`, then
    `.claude/skills/claudinho-mode/playbooks/confirmation-round.md`) and the review ledger's merge check passing,
    with the confirmed SHA held.
11. The merge stays the maintainer's: Dependabot PRs are merged by the maintainer, who reads
    `gh pr view <n> --json headRefOid` against the held SHA (a different head, after a Dependabot rebase, goes back
    to the confirmation round) and merges with `gh pr merge <n> --squash --match-head-commit <held sha>`. After a
    merge, the merged tree compared with the gated one and CI read per job on the merge commit.

## Gate

```
bash scripts/gate.sh
```

Every step's verdict read; its `audit` step is the registry's answer, and `audit SKIP (offline)` is not a pass.

## Push

```
bash scripts/push-and-watch.sh <branch>
```

For a hand-made bump the first push is a plain `git push -u origin <branch>` (CI runs on pull requests and on main
alone: before the pull request there is no run, and the watch would poll for one until its deadline), then
`gh pr create --base main --head <branch> --title "<subject>" --body-file <file>`, then this line, which pushes
nothing when the remote already has the head and prints each job's conclusion on it; every later push is this line.
A Dependabot head is not pushed by the agent: this line on a checkout of its branch only watches it (step 8).

## Evidence

- The lockfile delta as listed, the audit's exit, the reachability walk, the `tools/list` comparison (byte-identical
  or each difference named), the simulated pair's commit and its gate, the per-job table of each head.
- A commit made for a bump ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually
  in use.
- Kept privately, by role: the review ledger and its merge check, the private procedure's account of the round.

## Reply

A status ends Running, Blocked on you or Done. The run ends with a numbered "What I need from you": per item the
context, the options, the recommendation and the default.

## Ask

- Merge each PR at its confirmed head, and in which order; after the first, the rebase of the second.
- Whether the bump rides the next release, and whether the `.mcpb` bundle needs a rebuild.
