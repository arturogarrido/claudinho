# Contributing to Claudinho ⚽

Thanks for being here. Claudinho is an independent, open-source fan project for the
2026 men's football tournament — a CLI, a statusline, a score-aware hook, and an MCP
server. Issues, fixes, and ideas are all welcome.

**The fastest way to help: [⭐ star the repo](https://github.com/arturogarrido/claudinho).**
It's a solo, $0 project, and stars are the signal that it's worth maintaining.

## Ways to contribute

- **Report a bug** — a wrong score, a rendering glitch, a timezone/locale issue. Include
  the command you ran, your `--tz`/`--lang`, and what you saw vs. expected.
- **Suggest an idea** — open an issue before a large PR so we can align on scope.
- **Pick up a [`good first issue`](https://github.com/arturogarrido/claudinho/labels/good%20first%20issue)** —
  small, well-scoped starting points (new locale strings, a docs fix, a small surface tweak).

## Dev loop

```bash
pnpm install
pnpm -r build        # build every package
pnpm -r test         # vitest across packages (pnpm -F @claudinho/core test for one)
pnpm -r typecheck
pnpm lint            # Biome (lint-only; keep style consistent with surrounding code)
```

Try your change end-to-end before opening a PR:

```bash
node packages/cli/dist/index.js today --tz America/Mexico_City --lang es
```

## What to know before a PR

- **Read [`AGENTS.md`](AGENTS.md) first** — it's the engineering guide: the package
  layout, the provider/adapter model, the resultless-schedule and knockout
  live-resolve invariants, and the "apply the change to every surface" rule (CLI text
  **and** `--json`, MCP `data` **and** text, share, READMEs).
- **Hard constraints (legal — don't violate):** facts and **emoji flags only** — never
  crests, kits, player photos, or FIFA/Anthropic logos. Keep the *"Not affiliated with
  FIFA or Anthropic"* disclaimer on user-facing surfaces. Prediction-market data is
  **read-only and informational only** — never betting/trading framing.
- **Shared types live in `@claudinho/core`** — don't duplicate them; run
  `pnpm -r typecheck` after changing them.
- **Use [`AGENTS.md` → Validation scope](AGENTS.md#validation-scope).** Code, dependency,
  and executable configuration changes require the full gate (`build` → `typecheck` →
  `test` → `lint`) plus relevant smoke checks. User-facing behavior also requires
  `pnpm release:qa` and an output review. Prose-only changes use diff, link, contract,
  and private-document-boundary checks.

## Comparing MCP tool contracts

For MCP contract or schema-dependency changes, compare the actual `tools/list` output from the PR
base and head. Use separate checkouts at the recorded base/head SHAs, the same Node version and
environment, and each checkout's own `pnpm install --frozen-lockfile` followed by `pnpm -r build`.

From the base checkout's repository root, run the following. Run it again from the head checkout,
changing the output path to `/tmp/claudinho-tools-head.json`. The request sequence matches the
stdio smoke test, and listing tools makes no provider calls.

```bash
node --input-type=module > /tmp/claudinho-tools-base.json <<'NODE'
import { execFileSync } from 'node:child_process';
const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'contract-comparison', version: '1' },
  } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
];
const output = execFileSync(process.execPath, ['packages/mcp/dist/index.js'], {
  input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n',
  encoding: 'utf8', timeout: 30_000,
});
const replies = output.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const initialized = replies.find((reply) => reply.id === 1);
const listing = replies.find((reply) => reply.id === 2);
if (replies.some((reply) => reply.jsonrpc !== '2.0') || !initialized?.result ||
    !Array.isArray(listing?.result?.tools) || listing.result.nextCursor) {
  throw new Error('Incomplete or invalid MCP response; inspect before comparing');
}
process.stdout.write(JSON.stringify(listing.result.tools, null, 2) + '\n');
NODE
```

Both captures must exit successfully. Then run
`diff -u /tmp/claudinho-tools-base.json /tmp/claudinho-tools-head.json` and inspect every difference,
including descriptions, annotations, input/output schemas, `additionalProperties`, and ordering.
Record both SHAs and explain intentional changes in the PR; a dependency-only upgrade should not
silently change the contract. Also run `pnpm -F @claudinho/mcp smoke:stdio` on the built head:
it checks transport and an offline tool call, but does not compare the base and head listings.

## Commit attribution

Several AI coding agents work on this repo. If you used one, add a trailer in the last
paragraph of the commit (and credit it in the PR), using the model actually in use — e.g.
`Co-Authored-By: Claude Code (<actual Claude model>) <noreply@anthropic.com>`. See `AGENTS.md` →
"Commit attribution" for the convention.

## Code of conduct

Be kind and constructive. This is a fan project built for fun during the tournament —
keep it that way. 💛

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
