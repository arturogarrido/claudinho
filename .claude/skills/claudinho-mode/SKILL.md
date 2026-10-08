---
name: claudinho-mode
description: Use at the start of any task in this repository, before reading code: it names the playbook for the task kind, the guide sections to load, the gate and the reply shape.
---

# claudinho-mode

The operating procedure for work in this repository, loaded per task. Name the task's kind from the table below,
read the playbook its row names and the AGENTS.md sections and guide files in its "Load first" cell, then open a todo
list with the playbook's steps, in the playbook's order, before the first edit; the coordinator keeps that list
current until the reply. A playbook orders the rules of AGENTS.md and quotes the commands as they are run (the gate
line, the push line); AGENTS.md stays the canonical guide, and where a playbook or a guide disagrees with it AGENTS.md
wins. Every playbook ends with the same reply shape: a status ends Running, Blocked on you or Done, and a run ends with
a numbered "What I need from you". The playbooks live once, under `.claude/skills/claudinho-mode/playbooks/`; this
file is mirrored byte-equal at `.cursor/skills/claudinho-mode/SKILL.md`, and both name a playbook and a guide by its
repository-root path.

| Task kind | Playbook | Load first |
|---|---|---|
| A bug fix: a wrong output, a crash, a regression on a surface | `.claude/skills/claudinho-mode/playbooks/bug-fix.md` | "Validation scope", "Conventions", "Rules and their enforcers", "Change discipline"; the guide of the area the bug is in (the area table below) |
| A feature: a new behavior, command, tool, verdict or surface | `.claude/skills/claudinho-mode/playbooks/feature.md` | "Validation scope", "Conventions", "Hard constraints", "Pre-PR self-review", "Definition of Done"; `guides/conventions/surfaces.md`, `guides/conventions/verdicts.md`, `guides/conventions/selection.md`, and the guide of every other area it touches |
| A review round: the readers' first read of a head | `.claude/skills/claudinho-mode/playbooks/review-round.md` | "Reviewing PRs", "Pre-PR self-review", "Rules and their enforcers"; the guide of every area the patch touches |
| A confirmation round: the readers' read of a head after a fix | `.claude/skills/claudinho-mode/playbooks/confirmation-round.md` | "Reviewing PRs", "Rules and their enforcers"; the guides the first round loaded |
| Prose and agent instructions only | `.claude/skills/claudinho-mode/playbooks/docs-only.md` | "Validation scope" (its private-document boundary check), "Hard constraints", "Don't"; the guide whose text the change edits |
| A dependency bump, a Dependabot PR or an advisory | `.claude/skills/claudinho-mode/playbooks/dependency-bump.md` | "Validation scope", "Commands"; `guides/conventions/trust-boundary.md` for a provider or parsing dependency |
| A release: the version bump, the gate, the tag's watch | `.claude/skills/claudinho-mode/playbooks/release.md` | "Releasing", "Release readiness", "Release cadence"; `guides/conventions/bundle-and-bracket.md` (the bundle and the bracket tripwires) |
| The fallback: work no kind above matches | `.claude/skills/claudinho-mode/playbooks/feature.md` | every AGENTS.md section and every guide under `guides/conventions/` the diff touches |

The guides hold the narration behind the AGENTS.md "Conventions" bullets (a bullet whose narration moved ends with its
`Narration:` line) and what the Cursor glob rules stated that no bullet does. By area:

| Area | Guide |
|---|---|
| A provider adapter, the trust module, text roles, the cache constructors | `guides/conventions/trust-boundary.md` |
| Standings tables and their keys | `guides/conventions/standings.md` |
| A verdict, a qualifier, a cut text | `guides/conventions/verdicts.md` |
| `next`, `match <id>` and `bracket` off the bundle; composed windows and seasons | `guides/conventions/off-bundle-reads.md` |
| The refresher, the lock, the throttle note, discovery and the live gate | `guides/conventions/refresher.md` |
| The competition selection, the supported table, the mode line, the pin | `guides/conventions/selection.md` |
| Stages, team identity, flags and clubs | `guides/conventions/stage-and-teams.md` |
| The bundled schedule, the bracket, knockout and team-facing surfaces | `guides/conventions/bundle-and-bracket.md` |
| Bounds, the flair slot, format options, `release:qa`'s renders, share cards | `guides/conventions/surfaces.md` |
| Market signals | AGENTS.md "Conventions" alone (its bullet kept every sentence) |
