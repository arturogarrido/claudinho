# Playbook: docs only

Prose and agent instructions only: the READMEs, AGENTS.md, CONTRIBUTING.md, `.cursor/rules/`, a skill or a playbook.
No application build or live-feed check unless executable configuration, commands, package contents or product
behavior also change (AGENTS.md "Validation scope"); then the feature or bug-fix playbook applies instead.

## Steps

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
6. No build of its own unless executable configuration changed; the gate below is the PR's gate whatever its kind,
   and CI runs the same list on the pushed head.
7. Commit with the trailer, push with the push line below, read CI per job, then the review rounds as for any PR.

## Gate

```
bash scripts/gate.sh
```

Every step's verdict read; its `diff-check` and `pack` steps are the two that read prose (the whitespace check and
the private-path scan).

## Push

```
bash scripts/push-and-watch.sh <branch>
```

It refuses while another SHA's run is pending, pushes, reads the SHA back and prints each job's conclusion.

## Evidence

- The boundary check's JSON (zero leaks, zero tracked private files), the `git diff --check` result, the links
  checked.
- The commit ends with `Co-Authored-By: <Agent> (<Model>) <agent-no-reply-email>`, the model actually in use, and the
  PR body credits the same.
- Kept privately, by role: the review ledger and the pre-push scan's result.

## Reply

A status ends Running, Blocked on you or Done (the checks actually run, a skipped one said as skipped). The run ends
with a numbered "What I need from you": per item the context, the options, the recommendation and the default.

## Ask

- Merge the PR at the confirmed head.
- A stale claim found in passing outside the change: fix it here or track it.
