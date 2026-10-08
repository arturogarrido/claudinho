# Playbook: bug fix

A wrong output, a crash or a regression on a surface. The fix is a failing test first, then the product change that
makes it green, read by every reader on every head.

## Steps

1. Restate the ask in one line: what is wrong, on which surface (CLI text or `--json`, MCP text or `data`, the
   statusline, the hook, a share card), and what the right output is.
2. Find the test that pins the behavior, or write the failing one first. Run it and read the count from vitest's
   summary line (`Tests  N failed | M passed`), never from the presence of the line; commit the red test with that
   count in the message. Look up the failure class in AGENTS.md "Rules and their enforcers" and search its siblings
   (the cache constructor beside the provider's, the hook beside the statusline).
3. Reproduce it on the built binary with the verify skill: `node scripts/verify.mjs doctor`, then `run`, `mcp`,
   `prompt` or `hook` for the surface (`.claude/skills/verify-claudinho/SKILL.md`; the feature map under
   `.claude/skills/verify-claudinho/features/`), offline unless a recorded feed is named.
4. The coder's change, one commit in its own worktree with its trailer (`.claude/agents/claudinho-coder.md`): it
   makes the red tests green by changing the product and never edits a test; a test it believes wrong comes back
   proven on a copy, and the coordinator decides.
5. Prove the test pins the rule: revert the rule, run the test, read red, restore (for a call-site bug, remove the
   call). Rerun the verify skill's command from step 3 and keep its evidence.
6. Run the gate below and read it step by step.
7. Push with the push line below and read CI per job on the pushed SHA.
8. The review rounds (`.claude/skills/claudinho-mode/playbooks/review-round.md`, then
   `.claude/skills/claudinho-mode/playbooks/confirmation-round.md`): every reader confirms every head, nothing
   pending, P3 included; a fix made after review is read again by every reader.
9. The merge, when the maintainer authorized it: `gh pr merge <n> --squash --match-head-commit <sha>`, the SHA read
   from `gh pr view <n> --json headRefOid`, never typed; then CI per job on the merge commit.
10. The records, kept by role (see Evidence), then the reply.

## Gate

```
bash scripts/gate.sh
```

Every step prints `<name> ok (Ns)` or `<name> FAIL (Ns)` from its own exit status, a FAIL with the tail of its log;
read every line, not the last one. `audit SKIP (offline)` is not a pass. To commit through the gate,
`bash scripts/gate.sh --commit <message-file>` commits what is staged only when every step printed ok.

## Push

```
bash scripts/push-and-watch.sh <branch>
```

It refuses to push while a CI run for another SHA on the branch is pending (the push would cancel it), pushes, reads
the remote SHA back and prints every job's conclusion for the CI run on that SHA. Its exit is the answer; a run still
pending at the deadline is watched again by running the same line (nothing is pushed twice).

## Evidence

- The red test's commit, with its count in the message; the coder's commit, ending with the trailer
  `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use (AGENTS.md "Commit
  attribution"), and the PR body crediting the same.
- The gate's log directory (named in its summary), the push watch's per-job table, the verify skill's evidence
  directory.
- Kept privately, by role: the review ledger (one row per reader per head), the triage, the pre-push scan's result,
  the private procedure's account of the run.

## Reply

Every status ends with one word: Running (work continues, nothing is asked), Blocked on you (the run waits on an
answer, named), or Done (the outcome, the checks actually run, a skipped check said as skipped, the limits). The run
ends with a numbered "What I need from you": per item the context, the options, the recommendation and the default
taken if no answer comes.

## Ask

- Merge the PR at the head SHA the readers confirmed (the merge is the maintainer's unless authorized).
- Ship it as a hotfix (live data correctness only, AGENTS.md "Release cadence") or batch it onto the next release.
