# Playbook: feature

A new behavior, command, tool, verdict or surface, and the fallback for work no other kind matches. Everything in the
bug-fix playbook holds; a feature adds a plan gate, acceptance criteria and every surface.

## Steps

0. A branch and its own worktree, never the main checkout: `git worktree add -b <branch> <path> main`; every later
   step runs in `<path>`.
1. Restate the ask in one line, then write the Definition of Done before any code (AGENTS.md "Definition of Done"):
   three to five acceptance criteria from the user's point of view and what the change does NOT cover, in the PR
   body file (the pull request is opened at step 10).
2. A plan gate for a large or risky change, two rounds at most (the cap). The design packet, kept by role: the ask
   restated, the callers' examples, every state axis with its values, the owner of each decision, the next call and
   its concurrency, and two designs when a real choice exists. The readers read the packet before any code.
3. Enumerate every surface the change reaches (AGENTS.md "Pre-PR self-review", item 2): CLI text and `--json`, MCP
   `data` and text, the statusline and the hook, share, the READMEs; each surface's arguments (tz, locale, flags)
   threaded. A team-facing surface joins the coverage tests named in AGENTS.md "Rules and their enforcers".
4. The failing tests first, committed red with the count read from vitest's summary line; then the coder's one
   commit with its trailer (`.claude/agents/claudinho-coder.md`), which never edits a test.
5. The verify skill per surface (`.claude/skills/verify-claudinho/SKILL.md`): `node scripts/verify.mjs doctor`, then
   `run --twin`, `mcp`, `prompt` or `hook` for each surface the change touches, offline, the evidence kept. A new
   surface gets its file in `.claude/skills/verify-claudinho/features/`.
6. The mutation pass (revert each rule, run its test, read red, restore) and the real-feed parity against the base
   branch, key order included; both kept by role.
7. Run the gate below and read it step by step.
8. A user-facing change (AGENTS.md "Validation scope"): `pnpm release:qa` after a build, read whole; a SKIP is not a
   pass, and a skipped live-feed check is not verified behavior.
9. An MCP contract change (AGENTS.md "Validation scope"): `pnpm -F @claudinho/mcp smoke:stdio` and the base/head
   `tools/list` comparison of CONTRIBUTING.md "Comparing MCP tool contracts", compared by bytes.
10. The first push and the pull request, as the Push section says: `git push -u origin <branch>`, then
    `gh pr create --base main --head <branch> --title "<subject>" --body-file <file>` (the body as Evidence says),
    then the push line, which pushes nothing (the remote already has the head) and reads CI per job on it. Every
    later push is the push line.
11. The review rounds (`.claude/skills/claudinho-mode/playbooks/review-round.md`, then
    `.claude/skills/claudinho-mode/playbooks/confirmation-round.md`): every reader confirms every head, nothing
    pending, P3 included. HOLD the SHA the readers confirmed.
12. The merge, when authorized: read `gh pr view <n> --json headRefOid`; when it differs from the held SHA, REFUSE
    the merge (a push after the confirmation is an unreviewed head: it goes back to the confirmation round); else
    `gh pr merge <n> --squash --match-head-commit <held sha>`. Then CI per job on the merge commit, and the reply.

## Gate

```
bash scripts/gate.sh
```

Read every step's verdict line; a FAIL carries its log's tail, `audit SKIP (offline)` is not a pass. The gate runs
neither `pnpm release:qa` nor CI's Node 20, Windows and macOS jobs: the first is step 8, the second the push watch.

## Push

```
bash scripts/push-and-watch.sh <branch>
```

Every push after the pull request exists is this line: it refuses while another SHA's run is pending, pushes, reads
the remote SHA back and prints every job's conclusion for the CI run on that SHA. Read the per-job table after every
push, before the next round. The FIRST push is a plain `git push -u origin <branch>` (CI runs on pull requests and
on main alone: before the pull request there is no run, and the watch would poll for one until its deadline), then
`gh pr create --base main --head <branch> --title "<subject>" --body-file <file>`, then this line.

## Evidence

- The red tests' commit; the coder's commit with the trailer
  `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>` (the model actually in use).
- The PR body file: the acceptance criteria and the exclusions, the checks run, and at its end the two trailers (the
  coordinator's, for the tests, and the coder's, for the change, each with the model actually in use) and the
  generated-with line the coding client asks for.
- The verify skill's evidence directory per surface, the gate's log directory, the push watch's table, the
  `tools/list` comparison when the contract moved, the `pnpm release:qa` output, the held SHA and the merge commit.
- Kept privately, by role: the design packet and its readers' reports, the mutation runner's rows, the parity corpus
  and its comparison, the review ledger, the triage, the private procedure's account.

## Reply

A status ends Running, Blocked on you (the question named) or Done (the outcome, the checks actually run, each
skipped check said as skipped, the limits). The run ends with a numbered "What I need from you": per item the
context, the options, the recommendation and the default taken without an answer.

## Ask

- The acceptance criteria, when the plan gate changed them.
- Merge the PR at the confirmed head; whether the change is MCP-affecting enough to call for the `.mcpb` decision at
  the next release.
- Batch it onto the next release (the default, AGENTS.md "Release cadence") or release now.
