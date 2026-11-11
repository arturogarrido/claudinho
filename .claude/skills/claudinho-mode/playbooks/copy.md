# Playbook: copy

Public copy and growth work: a post, a reply, a listing, a directory entry, a README pitch. The words are drafted
here; nothing leaves without the maintainer's word.

## Steps

1. Restate the ask in one line: the channel, the audience, the one thing the copy says.
2. Read AGENTS.md "Hard constraints" first. Facts and emoji flags only; no crest, kit, photo, logo or wordmark; market
   data is informational only, never betting or trading advice.
3. The disclaimer comes from core's constant (`packages/core/src/disclaimer.ts`), copied, never rewritten; a listing
   host's composition is its `disclaimerLine(host)`. A count of the supported set comes from core's table
   (`packages/core/src/supported.ts`), never typed from memory.
4. Every product claim is checked against the product as it ships: a command runs as written, an output is
   captured from the real binary, a feature named is released.
5. Draft the copy in a file the maintainer can open, or in the reply when it is short.
6. Nothing is posted, submitted, sent or scheduled without the maintainer's word for that piece. Approval of one
   draft does not cover the next.
7. When the copy lives in a tracked file (a README, a listing manifest), the change continues in
   `.claude/skills/claudinho-mode/playbooks/docs-only.md`.

## Evidence

- The draft, with the channel and its length.
- The source of each claim: the command and its output, or the file and line.
- The disclaimer as copied from core's constant.

## Reply

A status ends Running, Blocked on you or Done. The run ends with a numbered "What I need from you": per item the
context, the options, the recommendation and the default. Each draft waiting for the maintainer's word is an item,
linked.

## Ask

- Post, submit or send each draft: the maintainer's word, per piece.
- A claim that needs a release before it is true.
