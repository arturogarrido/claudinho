# Playbook: audit

A read-only audit or investigation of the project: a question about the code, the process, the feed or the
history. Not a PR review (that is `.claude/skills/claudinho-mode/playbooks/review-round.md`). Nothing changes.

## Steps

1. Restate the question in one line and name what the answer will be read against: files, commits, CI runs, the
   live feed.
2. Read in the main checkout or a detached checkout. No branch, no worktree of your own, no pull request, no commit.
   Nothing is edited, pushed, posted or sent.
3. Read the current source, not memory: a fact that can change (a SHA, a version, a CI state, a feed shape) is read
   again before it is stated (AGENTS.md "Working agreement").
4. Mark every finding as **verified** (read or run, with the file and line, the command and its output) or
   **inferred** (reasoned, not run, with what would verify it). An inferred finding is never stated as a fact.
5. Classify defects P1/P2/P3 when the audit looks for them; a finding outside the question is listed apart.
6. The output is a document or a reply. A document the maintainer keeps privately is named by role, never by a path
   under the private folder.
7. A fix the audit finds is a separate task with its own playbook, started only on the maintainer's word.

## Evidence

- For each verified finding: the file and line, or the command and the line of its output that decided it.
- For each inferred finding: the reasoning and the check that would settle it.
- The checks that could not run, said as skipped.

## Reply

A status ends Running, Blocked on you or Done. The run ends with a numbered "What I need from you": per item the
context, the options, the recommendation and the default.

## Ask

- Which findings become tasks, and in what order.
- A finding that needs the maintainer's access or knowledge to verify.
