# Playbook: confirmation round

The head is read again after a fix. Who reads it depends on the PR's tier (AGENTS.md "Reviewing PRs").

## Tiers

- T0 does not run this round. The coordinator reads the delta and CI per job on the head, and holds that SHA.
- T1: only the reader that raised a finding confirms its fix. The other readers are not asked again.
- T2: every reader confirms the same head with nothing pending. The steps below are written for T2.
- A delta that changes prose alone or the PR body alone is not a round. In T0 and T1 the coordinator confirms it. In
  T2 the reader that raised the finding confirms it alone.
- The cap: at most 3 rounds per PR in any tier; the first read is round 1. After round 3 the coordinator stops and
  the maintainer decides: merge with the remaining P3 findings tracked, narrow the scope, or authorize more rounds.
- Text that is never public gets no round in any tier.
- The merge names a held SHA in every tier (`--match-head-commit`).

## Steps

1. The inputs as files with a manifest of their hashes: the delta patch since the previous reviewed head
   (`git diff <previous-head> <head>`), the full patch against the base, the PR body (which states the review's
   threat model), and, for each reader, that reader's own previous report (never another reader's) with the
   disposition of each of its findings from the triage.
2. A detached checkout at the head for the readers; the runner (`.claude/agents/claudinho-runner.md`) on the head in
   its own worktree, under one rule: when the head changed code, a test or executable configuration (commands,
   package contents, workflows, scripts), it installs, builds, runs the suite, `bash scripts/gate.sh` and its
   mutation pass on the rules the fix touched; when the head changed prose alone (AGENTS.md "Validation scope", first
   bullet), it runs `git diff --check` and the private-document boundary check, reads the delta, and runs no mutation
   pass (a moved rule's text is not a rule's code).
3. T2: every reader asked again after every fix, including a reader that confirmed the previous head: a fix made
   after review is read by every reader. T1: the reader that raised each finding is asked about its fix; the runner
   is asked when it raised one.
4. Each verdict read from its verdict line by name, its inputs matched against the manifest. A verdict is CONFIRMED
   only with nothing pending, P3 included; a deferral counts only as a tracked row the raising reader accepted in
   writing; a note (outside the threat model, AGENTS.md "Reviewing PRs") is not pending.
5. A new finding opens a fix list (`.claude/skills/claudinho-mode/playbooks/review-round.md`, steps 6 to 9) and
   another confirmation round, within the cap; the round count is recorded. After round 3 the coordinator stops and
   asks the maintainer.
6. The gate below on the head (for prose alone, `git diff --check` and the private-document boundary check), and the
   CI run on that SHA read per job.
7. The merge check, by role (the review ledger's): the CI run on the head SHA green per job, and that head confirmed
   as the tier asks (T2: every reader CONFIRMED on that same SHA; T1: each raising reader CONFIRMED its fix, and a
   later prose-only or body-only delta confirmed by the coordinator; T0: the coordinator's read). HOLD that SHA: it is
   the only one the merge may name.
8. The merge, when authorized: read `gh pr view <n> --json headRefOid`; when it differs from the held SHA, REFUSE
   the merge (a push after the confirmation is an unreviewed head: this round runs again on it); else
   `gh pr merge <n> --squash --match-head-commit <held sha>`, the SHA copied from the merge check, never typed.
9. The merged tree compared with the gated head's: `git rev-parse <merge>^{tree}` against
   `git rev-parse <head>^{tree}`; a difference (a base that moved) is gated again. CI per job on the merge commit.

## Gate

```
bash scripts/gate.sh
```

Every step's verdict line read on the head the readers confirmed, when the head changed code, a test or executable
configuration (commands, package contents, workflows, scripts); the merged tree gated again when it differs. For prose
alone (AGENTS.md "Validation scope", first bullet), `git diff --check` and the private-document boundary check
instead, and no mutation pass.

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
- A reader that cannot run (out of budget): wait for it, or the maintainer's decision; never a merge without the
  confirmations the tier asks (T2: every reader's; T1: each raising reader's).
- The cap reached: after round 3, merge with the remaining P3 findings tracked, narrow the scope, or authorize more
  rounds.
