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

The guides hold the narration behind the AGENTS.md "Conventions" bullets and what the Cursor glob rules stated that no
bullet does. An area below names its bullet by the bullet's lead; a guide is named only where that bullet ends with a
`Narration:` line, and "the bullet alone" means the bullet kept every sentence:

| Area | AGENTS.md "Conventions" bullet | Guide |
|---|---|---|
| A provider adapter, the trust module, the cache constructors | "Every data vendor implements the `ProviderAdapter` interface" | `guides/conventions/trust-boundary.md` |
| Text roles, flags generated from a nation | "Text has ROLES, not one universal cleaner" | `guides/conventions/trust-boundary.md` |
| Standings tables and their keys | "A table has a key, and the key comes from the raw name" | the bullet alone |
| Where standings come from | "Standings come from the provider's standings feed, NOT computed from a match window" | `guides/conventions/standings.md` |
| A verdict, a qualifier, a cut text | "A verdict becomes output in ONE place" | `guides/conventions/verdicts.md` |
| `next`, `match <id>` and `bracket` off the bundle | "Off the bundled competition, `next`, `match <id>` and `bracket` answer from the competition itself" | `guides/conventions/off-bundle-reads.md` |
| Composed windows and seasons | "A window is composed of the requests the provider accepts" | `guides/conventions/off-bundle-reads.md` |
| The lock, the throttle note, the attempt record | "A refresher decides under the lock, and a throttle always has somewhere to be written" | the bullet alone |
| Discovery and the live gate | "Off the bundled competition the refresher discovers, then polls only when a match can be in play" | `guides/conventions/refresher.md` |
| The supported table | "The supported set is ONE table, and every written fact of a competition derives from it" | the bullet alone |
| The competition selection, the saved choice, the pin | "The competition is decided ONCE, at the edge, and then travels as a value" | `guides/conventions/selection.md` |
| Stages | "The stage comes from a written grammar over the WHOLE season slug, with the competition's written kind" | the bullet alone |
| Team identity, flags and clubs | "A team's identity is the provider's id; its code is a label" | the bullet alone |
| The bracket's pairings | "The live fixture's pairing wins over the static topology's winner-refs" | `guides/conventions/bundle-and-bracket.md` |
| Knockout and team-facing surfaces | "Knockout/team-facing surfaces MUST live-resolve" | `guides/conventions/bundle-and-bracket.md` |
| Market signals | "Market signals use a separate `MarketProvider` interface" | the bullet alone |

What a Cursor glob rule stated that no bullet does is in the guide named in that rule's last paragraph:
`guides/conventions/trust-boundary.md`, `guides/conventions/off-bundle-reads.md`, `guides/conventions/verdicts.md`,
`guides/conventions/selection.md`, `guides/conventions/stage-and-teams.md`, `guides/conventions/bundle-and-bracket.md`
and `guides/conventions/surfaces.md`, each under a heading naming the rule.
