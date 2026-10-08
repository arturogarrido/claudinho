# Playbook: review round

The readers' first read of a PR head. The coordinator prepares the inputs, the readers and the runner read, and every
verdict and finding becomes a row before anything goes back to the coder.

## Steps

1. Confirm the head: `gh pr view <n> --json headRefOid,headRefName` against the local `git rev-parse HEAD`
   (AGENTS.md "Reviewing PRs"); the CI run on that SHA read per job.
2. A detached checkout per round for the readers, at the head SHA, never the coder's worktree: a reader reads a
   tree nobody is editing.
3. The inputs as files: the full patch against the base (`git diff <base>...<head>`), the PR body, and a manifest of
   their hashes; the first 12 hex of the manifest's digest name the inputs every verdict line must carry.
4. The runner on the head (`.claude/agents/claudinho-runner.md`): its own worktree, the suite, the gate, its own
   mutation pass, and whatever the readers could not run. The verifier (`.claude/agents/claudinho-verifier.md`)
   when a surface changed.
5. Every verdict read from its verdict line by name (`- Verdict: <value> · inputs <12 hex>`), never from a tail, a
   grep of the body or a summary; inputs that do not match the manifest void the verdict.
6. The triage: one row per (reader, finding), each with a disposition: fix, not a defect (with the proof), or
   deferred (a tracked row the raising reader accepts in writing). A finding no one reproduced is reproduced first.
7. The fix list: a finding with two actions is two rows. A rule a fix introduces names its failure state, the set it
   is about, and the inputs it hands onward.
8. The fix list checked against the standing rules (AGENTS.md "Conventions", "Rules and their enforcers", "Change
   discipline") and the plan-gate questions before it goes to the coder; the coder's commit carries its trailer
   and never edits a test.
9. Run the gate below on the fixed head, push with the push line below, and read the per-job CI after every push,
   before the next round.
10. Then the confirmation round (`.claude/skills/claudinho-mode/playbooks/confirmation-round.md`).

## Gate

```
bash scripts/gate.sh
```

Run on the fixed head before it is pushed, and by the runner on the head it reads; every step's verdict read.

## Push

```
bash scripts/push-and-watch.sh <branch>
```

The per-job table of the CI run on the pushed SHA is read before the next round is prepared.

## Evidence

- The manifest and the inputs it names; each reader's report, kept whole; the runner's report with its mutation
  rows.
- Kept privately, by role: the review ledger (one row per reader per head, its verdict and inputs), the triage, the
  fix list, the pre-push scan's result. Reports are never posted publicly.
- Every fix commit ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use.

## Reply

A status ends Running, Blocked on you or Done. The round's account names each reader's verdict line as read, the
count of findings by severity and disposition, and what goes to the coder. The run ends with a numbered
"What I need from you": per item the context, the options, the recommendation and the default.

## Ask

- A deferral the raising reader has not accepted, and whether it is carried by the maintainer's decision.
- A finding that changes the scope or the acceptance criteria.
