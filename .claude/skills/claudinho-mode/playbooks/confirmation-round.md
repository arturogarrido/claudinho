# Playbook: confirmation round

Every reader reads the head again after a fix. A PR merges only when every reader confirms the same head with nothing
pending.

## Steps

1. The inputs as files with a manifest of their hashes: the delta patch since the previous reviewed head
   (`git diff <previous-head> <head>`), the full patch against the base, the PR body, and, for each reader, that
   reader's own previous report (never another reader's).
2. A detached checkout at the head for the readers; the runner (`.claude/agents/claudinho-runner.md`) on the head in
   its own worktree. When the change touches executable configuration, commands, package contents or product code, it
   installs, builds, runs the suite and `bash scripts/gate.sh`, and reruns its mutation pass on the rules the fix
   touched; for prose alone (AGENTS.md "Validation scope", first bullet) it runs `git diff --check` and the
   private-document boundary check and reads the delta.
3. Every reader asked again after every fix, including a reader that confirmed the previous head: a fix made after
   review is read by every reader.
4. Each verdict read from its verdict line by name, its inputs matched against the manifest. A verdict is CONFIRMED
   only with nothing pending, P3 included; a deferral counts only as a tracked row the raising reader accepted in
   writing.
5. A new finding opens a fix list (`.claude/skills/claudinho-mode/playbooks/review-round.md`, steps 6 to 9) and
   another confirmation round; the round count is recorded.
6. The gate below on the head (for prose alone, `git diff --check` and the private-document boundary check), and the
   CI run on that SHA read per job.
7. The merge check, by role (the review ledger's): every reader CONFIRMED on the same head SHA, the CI run on that
   SHA green per job. HOLD that SHA: it is the only one the merge may name.
8. The merge, when authorized: read `gh pr view <n> --json headRefOid`; when it differs from the held SHA, REFUSE
   the merge (a push after the confirmation is an unreviewed head: this round runs again on it); else
   `gh pr merge <n> --squash --match-head-commit <held sha>`, the SHA copied from the merge check, never typed.
9. The merged tree compared with the gated head's: `git rev-parse <merge>^{tree}` against
   `git rev-parse <head>^{tree}`; a difference (a base that moved) is gated again. CI per job on the merge commit.

## Gate

```
bash scripts/gate.sh
```

Every step's verdict line read on the head the readers confirmed, when the change touches executable configuration,
commands, package contents or product code; the merged tree gated again when it differs. For prose alone (AGENTS.md
"Validation scope", first bullet), `git diff --check` and the private-document boundary check instead.

## Push

```
bash scripts/push-and-watch.sh <branch>
```

Each fix head is pushed with it and its per-job CI read before the confirmation round is prepared.

## Evidence

- Each reader's report per head, kept whole; the delta patch and the manifest.
- Kept privately, by role: the review ledger's row per reader per head and its merge check, the triage, the private
  procedure's account of the rounds.
- The squash commit's message keeps the trailer `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>` of the
  agent and model that did the work.

## Reply

A status ends Running, Blocked on you or Done; Done names the merge commit, the tree comparison and the per-job CI.
The run ends with a numbered "What I need from you": per item the context, the options, the recommendation and the
default.

## Ask

- Merge at the confirmed head, when the merge is not already authorized.
- A reader that cannot run (out of budget): wait for it, or the maintainer's decision; never a merge without every
  reader's confirmation.
