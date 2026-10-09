# Playbook: docs only

Prose and agent instructions only: the READMEs, AGENTS.md, CONTRIBUTING.md, `.cursor/rules/`, a skill or a playbook.
No application build or live-feed check unless executable configuration, commands, package contents or product
behavior also change (AGENTS.md "Validation scope"); then the feature or bug-fix playbook applies instead.

## Steps

0. A branch and its own worktree, never the main checkout: `git worktree add -b <branch> <path> main`; every later
   step runs in `<path>`. Then `pnpm install --frozen-lockfile` in `<path>`, before anything is built, tested or
   gated there (a worktree git just made has no `node_modules`).
1. Restate the ask in one line and name the files the change touches.
2. Edit. A count of the supported set, the framing and the disclaimer derive from core's table and constant: the
   guards in AGENTS.md "Rules and their enforcers" name which files are pinned.
3. `git diff --check`.
4. The private-document boundary check, from the repository root, as AGENTS.md "Validation scope" gives it:

   ```bash
   node --input-type=module <<'NODE'
   import { execFileSync } from 'node:child_process';
   import { scanTrackedFiles } from './scripts/private-doc-refs.mjs';
   const trackedPrivateFiles = execFileSync('git', ['ls-files', '-z', '--', 'docs/'], { encoding: 'utf8' })
     .split('\0').filter(Boolean);
   const result = scanTrackedFiles(process.cwd());
   console.log(JSON.stringify({ ...result, trackedPrivateFiles }, null, 2));
   if (result.leaks.length || trackedPrivateFiles.length) process.exitCode = 1;
   NODE
   ```

   It scans tracked files: stage a new file before running it. The maintainer's private folder is named by role
   only, never by a path under it.
5. Links and stated contracts checked: every relative link resolves, every command the prose names runs as written,
   every claim about a script, a test or a flag read against that file.
6. The gate below only when the change also touches executable configuration, commands, package contents or product
   behavior (AGENTS.md "Validation scope", first bullet); prose alone stops at steps 3 to 5.
7. Commit with the trailer. The first push and the pull request, as the Push section says:
   `git push -u origin <branch>`, then
   `gh pr create --base main --head <branch> --title "<subject>" --body-file <file>` (the body as Evidence says),
   then the push line to read CI per job on that head. Every later push is the push line.
8. The review rounds (`.claude/skills/claudinho-mode/playbooks/review-round.md`, then
   `.claude/skills/claudinho-mode/playbooks/confirmation-round.md`), as for any PR. HOLD the SHA the readers
   confirmed.
9. The merge, when authorized: read `gh pr view <n> --json headRefOid`; when it differs from the held SHA, REFUSE
   the merge (a push after the confirmation is an unreviewed head: it goes back to the confirmation round); else
   `gh pr merge <n> --squash --match-head-commit <held sha>`. Then CI per job on the merge commit.

## Gate

When the change also touches executable configuration, commands, package contents or product behavior (AGENTS.md
"Validation scope", first bullet), run:

```
bash scripts/gate.sh
```

Every step's verdict read. Prose alone needs `git diff --check`, the private-document boundary check above, and the
links checked; CI still runs its list on the pushed head, read per job by the push line.

## Push

```
bash scripts/push-and-watch.sh <branch>
```

Every push after the pull request exists is this line: it refuses while another SHA's run is pending, pushes, reads
the SHA back and prints each job's conclusion. The FIRST push is a plain `git push -u origin <branch>` (CI runs on
pull requests and on main alone, so before the pull request there is no run to watch), then
`gh pr create --base main --head <branch> --title "<subject>" --body-file <file>`, then this line.

## Evidence

- The boundary check's JSON (zero leaks, zero tracked private files), the `git diff --check` result, the links
  checked.
- The commit ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use. The PR
  body file ends with the trailers of the agents whose commits the branch carries (two when a coordinator and a
  coder both committed) and the generated-with line the coding client asks for.
- The held SHA and the merge commit.
- Kept privately, by role: the review ledger and the pre-push scan's result.

## Reply

A status ends Running, Blocked on you or Done (the checks actually run, a skipped one said as skipped). The run ends
with a numbered "What I need from you": per item the context, the options, the recommendation and the default.

## Ask

- Merge the PR at the confirmed head.
- A stale claim found in passing outside the change: fix it here or track it.
