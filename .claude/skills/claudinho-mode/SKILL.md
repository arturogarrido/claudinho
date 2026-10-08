---
name: claudinho-mode
description: Use at the start of any task in this repository, before reading code: it names the playbook for the task kind, the guide sections to load, the gate and the reply shape.
---

# claudinho-mode

The operating procedure for work in this repository, loaded per task. Name the task's kind from the table below,
read the playbook its row names and the AGENTS.md sections in its "Load first" cell, then open a todo list with the
playbook's steps, in the playbook's order, before the first edit; the coordinator keeps that list current until the
reply. A playbook orders the rules of AGENTS.md and quotes the commands as they are run (the gate line, the push
line); AGENTS.md stays the canonical guide, and where the two disagree AGENTS.md wins. Every playbook ends with the
same reply shape: a status ends Running, Blocked on you or Done, and a run ends with a numbered
"What I need from you". The playbooks live once, under `.claude/skills/claudinho-mode/playbooks/`; this file is
mirrored byte-equal at `.cursor/skills/claudinho-mode/SKILL.md`, and both name a playbook by its repository-root
path.

| Task kind | Playbook | Load first |
|---|---|---|
| A bug fix: a wrong output, a crash, a regression on a surface | `.claude/skills/claudinho-mode/playbooks/bug-fix.md` | "Validation scope", "Conventions", "Rules and their enforcers", "Change discipline" |
| A feature: a new behavior, command, tool, verdict or surface | `.claude/skills/claudinho-mode/playbooks/feature.md` | "Validation scope", "Conventions", "Hard constraints", "Pre-PR self-review", "Definition of Done" |
| A review round: the readers' first read of a head | `.claude/skills/claudinho-mode/playbooks/review-round.md` | "Reviewing PRs", "Pre-PR self-review", "Rules and their enforcers" |
| A confirmation round: the readers' read of a head after a fix | `.claude/skills/claudinho-mode/playbooks/confirmation-round.md` | "Reviewing PRs", "Rules and their enforcers" |
| Prose and agent instructions only | `.claude/skills/claudinho-mode/playbooks/docs-only.md` | "Validation scope" (its private-document boundary check), "Hard constraints", "Don't" |
| A dependency bump, a Dependabot PR or an advisory | `.claude/skills/claudinho-mode/playbooks/dependency-bump.md` | "Validation scope", "Commands" |
| A release: the version bump, the gate, the tag's watch | `.claude/skills/claudinho-mode/playbooks/release.md` | "Releasing", "Release readiness", "Release cadence" |
| The fallback: work no kind above matches | `.claude/skills/claudinho-mode/playbooks/feature.md` | every AGENTS.md section the diff touches |
