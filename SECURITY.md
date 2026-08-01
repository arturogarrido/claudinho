# Security Policy

## Reporting a vulnerability

Please report security issues **privately** through GitHub's
[Report a vulnerability](https://github.com/arturogarrido/claudinho/security/advisories/new)
form. That opens a private advisory only you and the maintainer can see, so a fix can ship
before the details are public.

Please do **not** open a public issue for a suspected vulnerability.

Claudinho is a solo, unpaid, open-source side project, so there is **no guaranteed response
time and no bug bounty**. Reports are read and taken seriously, but triage happens when the
maintainer has time.

## Supported versions

Only the **latest published version** of each package is supported. There are no maintenance
branches; fixes ship in a new release rather than as backports.

| Package | Supported |
|---|---|
| `@claudinho/cli`, `@claudinho/mcp`, `@claudinho/core` | latest release only |

## What Claudinho actually does

Most of what people expect to be risky here isn't present, so this section is offered to save
a reporter time. Every statement below is checkable against the source in this repo.

**No server, no listener.** The MCP server speaks **stdio only** — it binds no port and starts
no HTTP server. The published bundle imports exactly `sdk/server/mcp.js`, `sdk/server/stdio.js`
and `zod`; the SDK's HTTP transports are never loaded. The CLI and statusline likewise listen
on nothing.

**No credentials.** Claudinho requires no API key, token, or account, and handles none at
runtime. Beyond its own `CLAUDINHO_*` options it reads only environment used for display and
paths: `LANG`, `NO_COLOR`, `XDG_CACHE_HOME`, `TERM_PROGRAM` (terminal detection, for the
flag-emoji fallback), and the home directory via `os.homedir()` (`HOME` / `USERPROFILE`).

**Two outbound hosts, both public and read-only.**

| Host | Purpose | Notes |
|---|---|---|
| `site.api.espn.com` | live scores, fixtures, standings | attributed in output as `Live data: ESPN` |
| `gamma-api.polymarket.com` | read-only prediction-market signals | opt-out via `CLAUDINHO_MARKETS=off`; host allow-listed in code |

Requests are anonymous GETs — no account and no credentials. They do carry the parameters a
lookup needs: the requested date, and the competition slug (`CLAUDINHO_COMPETITION`, which
selects the ESPN competition path). They use `redirect: 'error'` (no redirect following), an
abort-signal timeout, and a declared-content-length cap before parsing. As with any HTTP
request the provider also receives normal transport metadata such as your IP address and
headers — see [PRIVACY.md](PRIVACY.md).

The bundled 104-fixture schedule is an **offline fallback**, not the default path: live-aware
commands try the provider first and degrade to the bundle on any network or provider error.
That includes `next`, which live-resolves knockout ties before falling back. `team` is the
genuinely offline lookup (it only consults the bundled roster).

**Local writes only.** A cache in `$XDG_CACHE_HOME/claudinho` (default `~/.cache/claudinho`),
written atomically via tmp+rename. The optional `init` commands modify your editor's own config
(`~/.claude/settings.json` or `~/.cursor/cli-config.json`) after saving a one-time `.claudinho.bak`
backup. Nothing is uploaded. See [PRIVACY.md](PRIVACY.md) for the full data-handling picture.

**Untrusted input is treated as untrusted.** Provider responses pass through a sanitizer at the
adapter boundary before they can reach a terminal, a share card, `--json`, MCP
`structuredContent`, or the model's context via the hook. The local caches get the same
treatment **on read** — both the match/statusline cache and the market-signal cache — since a
file on disk is attacker-writable in a way the type system does not capture. Concretely:

- **Allow-listed fields.** Only declared keys are rebuilt, so an injected key cannot ride into
  `--json` or MCP output.
- **Validated by runtime type _and range_**, not by the declared type. A field declared
  `number` can hold a string in JSON; scores, minutes and probabilities are also bounded, so a
  malformed value degrades to "no score" rather than rendering `1e+308` as fact.
- **Control _and format_ characters removed**, filtered by Unicode category rather than by
  code-point range. That covers bidi overrides and isolates, not just ANSI escapes: a single
  U+202E in a team name transposes the *displayed* score under the Unicode Bidirectional
  Algorithm, which matters most on share cards, since those exist to be pasted into tools that
  implement it. Emoji flags are exempted as whole grapheme clusters, because two of the flags
  shipped here are tag sequences built from format characters.
- **Bounded** per field (display columns, code points, and grapheme-cluster length) and per
  record count on the MCP and hook surfaces, which is where a model reads. Truncation is stated,
  never silent. The CLI's own terminal output and `--json` are deliberately *not* record-capped —
  there the full day's list is the correct answer — but the record count is bounded upstream at
  the adapter, so the input is not unbounded either.
- **Identifiers and timestamps are grammar-checked, not merely stripped**, on both the live and
  cached paths. Both land in model context without being rendered as prose, so they never *look*
  wrong — and stripping control characters leaves printable prose untouched. Timestamps are
  re-emitted in one canonical form, and a date that does not exist is refused rather than rolled
  over into a different one.
- **Invisible characters are treated as a payload channel, not as noise.** Bidi controls, tag
  characters and variation selectors are each invisible and each map onto a text alphabet, so a
  single glyph can carry a sentence a model will read. Only exact, allow-listed flag sequences may
  carry tag characters, and a grapheme cluster longer than any real character is refused whole.
- **Fail closed, including on absence.** A missing field must be at least as rejecting as a
  wrong one; several gates once skipped themselves when their field was absent, which made a
  more malformed payload more likely to be accepted.
- **Derived values are recomputed, never trusted** — the market favorite and staleness are
  derived from the sanitized data, so a crafted file cannot make the headline contradict the
  numbers, or an old reading claim to be fresh.

These properties are pinned by property tests rather than by per-vector regression tests, so a
field added without a check fails the suite by default.

**Subprocesses.** Two, both with a fixed argument array and never `shell: true`, so no shell
interpolation is possible. (1) The statusline spawns a detached background refresher via
`spawn(process.execPath, [...])`. (2) `share --copy` runs a platform clipboard helper —
`pbcopy`, `clip`, `wl-copy`, `xclip` or `xsel` — resolved through `PATH`, with the snippet
passed on stdin rather than as an argument. `PATH`-resolved execution is worth knowing about:
on a machine whose `PATH` an attacker already controls, that name could resolve to their
binary — though such an attacker can generally run code anyway.

### Things genuinely worth reporting

- A way to make feed or cache content escape sanitization and reach the terminal, a share
  snippet, or the hook's context (ANSI/control-character injection, or prompt injection into
  an agent's context).
- A path-traversal or arbitrary-write via `CLAUDINHO_*` environment values, the cache path, or
  the `init` config writers.
- Any outbound request to a host not listed above, or any credential/PII leaving the machine.
- A dependency vulnerability that is actually **reachable** from the stdio server or the CLI —
  reachability is the interesting part, since most advisories against the MCP SDK's transitive
  HTTP stack concern code Claudinho never loads.

### Known, accepted limitations

- A response body sent **without** a `content-length` header bypasses the size cap (documented
  at `MAX_RESPONSE_BYTES`); a streaming cap is deferred.
- Claudinho trusts its data providers for factual accuracy. It fails closed rather than
  displaying invented data, but a compromised upstream feed could still show wrong scores.
- Sanitizing is defence in depth, not a proof. It constrains what reaches output; it cannot
  make a compromised provider's *numbers* correct.
- The bounds above are chosen well above any real football value rather than derived from the
  fixture list, so they stop absurdity, not merely-implausible values.
- Sanitizing normalizes what a *string* can contain, not what it can *say*. A provider that
  serves a plausible-looking team name is echoed as-is; only its shape is constrained.
- Stripping format characters also removes ZERO WIDTH NON-JOINER (U+200C), which is
  orthographic in Persian and several Indic scripts. Both current providers serve Latin-script
  names, so nothing is lost today; a future adapter serving native-script names would need an
  exemption modelled on the flag one — a structural grammar, not a blanket carve-out.
- Emoji are preserved as whole grapheme clusters so flags survive, and the only clusters allowed
  to carry TAG characters are well-formed subdivision flags. That restriction is the point: tag
  characters map one-to-one onto printable ASCII, so an unrestricted cluster is a covert channel
  that renders as a single two-column glyph.

## Supply chain

All three packages publish from CI with **npm provenance** via OIDC trusted publishing — there
is no long-lived npm token. GitHub Actions are pinned to full commit SHAs (not tags), including
in the workflow that holds the publishing credential. Dependency updates and security alerts run
through Dependabot.

---

Claudinho is an independent, open-source fan project. **Not affiliated with, endorsed by, or
connected to FIFA or Anthropic.**
