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

**Untrusted input is treated as untrusted.** Provider feed strings pass through a sanitizer at
the adapter boundary (control characters and escape sequences stripped, length capped) before
they can reach a terminal, a share card, or the model's context via the hook. The local caches
get the same treatment **on read** — both the match/statusline cache and the market-signal
cache — since a file on disk is attacker-writable in a way the type system does not capture.
Sanitizing is allowlist-based (only known fields survive, so an injected key cannot ride into
`--json` or MCP output) and validates by runtime type, not the declared one: malformed
numbers, enums, timestamps and booleans are dropped or fail closed, because JSON on disk can
hold anything. Derived values such as the market favorite are recomputed from the sanitized
data rather than trusted, so a crafted file cannot make the headline contradict the numbers.

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
- Provider-supplied timestamps are echoed verbatim in MCP structured output (`asOf`,
  `fetchedAt`) once they parse as dates. They are validated as real date strings, not
  reformatted, so they are timestamp-shaped rather than guaranteed byte-for-byte canonical.

## Supply chain

All three packages publish from CI with **npm provenance** via OIDC trusted publishing — there
is no long-lived npm token. GitHub Actions are pinned to full commit SHAs (not tags), including
in the workflow that holds the publishing credential. Dependency updates and security alerts run
through Dependabot.

---

Claudinho is an independent, open-source fan project. **Not affiliated with, endorsed by, or
connected to FIFA or Anthropic.**
