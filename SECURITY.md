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

**Untrusted input is treated as untrusted.** Feed responses and local cache files enter through
one trust boundary (`packages/core/src/trust/`) and leave as domain types or as a stated reason
they could not. Nothing else builds a `Match` or a `MarketSignal` from raw input. This matters
because there are two ways data reaches a renderer — live from the provider, and read back from
the cache the statusline renders on every prompt — and when those paths had separate rules, a fix
applied to one of them left the other open. Both now end at the same constructor.

Each property below names the test that proves it. If a claim here is not pinned by a test, it is
a claim we cannot make.

- **Allow-listed fields.** Only declared keys are rebuilt, so an injected key cannot ride into
  `--json` or MCP output. — `core/test/trust-properties.test.ts` *(property: allowlist)*
- **Validated by runtime type _and range_**, not by the declared type. A field declared `number`
  can hold a string in JSON; scores, minutes and probabilities are also bounded. A malformed
  required score, claimed shootout, or market leg rejects its containing record rather than
  rendering `1e+308` as fact or silently changing what the record means. —
  `core/test/trust-properties.test.ts` *(property: runtime type and range)*,
  `core/test/trust-boundary.test.ts`
- **Control _and format_ characters removed**, filtered by Unicode category rather than by
  code-point range. That covers bidi overrides and isolates, not just ANSI escapes: a single
  U+202E in a team name transposes the *displayed* score under the Unicode Bidirectional
  Algorithm, which matters most on share cards, since those exist to be pasted into tools that
  implement it. — `core/test/trust-properties.test.ts` *(property: control/format characters)*
- **No emoji is accepted from input at all.** Product glyphs — every flag — are GENERATED from
  the nation, never read from a payload or a cache file. This replaced an emoji carve-out in the
  text filter, and the carve-out is worth describing because it was the single most productive
  bug source here: flags had to travel through the filter, so the filter needed an exemption, and
  an exemption without its own grammar is a channel. Tag characters, then variation selectors,
  then ZWJ each rode through it in turn. A `🏴` plus 42 tag characters is one grapheme cluster
  measuring two display columns that spells a full instruction sentence — invisible on a
  terminal, perfectly legible to a model reading `--json`. There is now nothing to exempt. —
  `core/test/flags-generated.test.ts`, `core/test/trust-properties.test.ts` *(property: no emoji
  in a label)*
- **Bounded** per field (display columns, code points, and grapheme-cluster length), per nested
  collection, and per record count on the MCP and hook surfaces, which is where a model reads.
  Collections are bounded *before* the per-record work, not after, so a large payload cannot cost
  CPU on a 150 ms-budget surface before being discarded. What is bounded is the input EXAMINED,
  not the results kept, so records that cannot be read can never crowd out one that can. Truncation
  is stated, never silent, and exact `+N` counts are shown only after a complete scan; an incomplete
  hot-path scan uses a nonnumeric `+more` marker rather than guessing how many valid records remain.
  The MCP response cap is total, and a depth/width/entry/text preflight bounds the work before
  serialization or recursive shrinking. Schema-preserving reductions carry declared response
  metadata; if the payload cannot fit without violating its output schema, the tool returns a
  bounded explicit error and omits `structuredContent`. —
  `mcp/test/bounded-payload.test.ts`, `mcp/test/response-size.test.ts`,
  `cli/test/hotpath-work.test.ts`, `cli/test/review-round15.test.ts`,
  `core/test/trust-espn.test.ts`
- **Identifiers and timestamps are grammar-checked, not merely stripped**, on both the live and
  cached paths. Both land in model context without being rendered as prose, so they never *look*
  wrong — and stripping control characters leaves printable prose untouched. Timestamps are
  re-emitted in one canonical form, and a date that does not exist is refused rather than rolled
  over into a different one. — `core/test/trust-parity.test.ts`, `core/test/trust-espn.test.ts`
- **Fail closed, including on absence.** A missing field must be at least as rejecting as a wrong
  one; several gates once skipped themselves when their field was absent, which made a more
  malformed payload more likely to be accepted. The same rule governs whole records: an
  unrecognized match status drops the fixture rather than defaulting to `SCHEDULED`, which would
  have erased the score of a match being played. —
  `core/test/trust-properties.test.ts` *(property: absent is at least as rejecting)*,
  `core/test/review-round15.test.ts`
- **Record refusal does not masquerade as a provider outage.** Provider adapters keep their plain
  array contract. A malformed, duplicate, or truncated ESPN record is omitted while readable
  siblings keep their provider attribution; one odd record must not blank a matchday or standings
  table. A transport/JSON failure, an unreadable envelope, or a non-empty provider list with no
  usable records still throws and reaches the domain's degraded fallback. Parser-local
  `BoundedList.complete` remains a test and diagnostics property, not a batch-wide kill switch.
  Standings expected scope never authorizes static teams: only the separate
  `standingsFallbackGroups` contract permits a bundled roster. A custom competition therefore
  returns empty + degraded on transport failure, missing capability, or an omitted expected table
  and never receives World Cup teams. An aggregate read uses one fallback verdict because its
  single attribution cannot describe mixed live and static provenance honestly. —
  `core/test/adapter-hardening.test.ts`, `core/test/espn.test.ts`,
  `core/test/standings-live.test.ts`, `core/test/trust-espn.test.ts`
- **Derived values are recomputed, never trusted** — the market favorite and staleness are
  derived from the sealed data, so a crafted file cannot make the headline contradict the
  numbers, or an old reading claim to be fresh. A team's flag is derived the same way, from its
  name. — `core/test/trust-parity.test.ts`
- **"We could not read this" is never recorded as "there is nothing here."** A rejection states
  which KIND it is, and the line for remembering it is whether we understood the bytes. A
  definitive "no market" and a structural ambiguity are both conclusions drawn from a payload we
  read, and both are stable across a refetch, so both may be cached for a TTL. A shape we could
  not read, or a deadline that expired, are facts about *us* — never remembered, always retried,
  the mirror image of never caching a transient error as a real negative. —
  `core/test/market-verdict.test.ts`
- **Enrichment completeness reaches every surface.** Default-on market annotations, dedicated
  market tools, share cards, and their structured output retain the batch's completeness verdict.
  A complete empty read may say "no signal"; an incomplete one carries `marketComplete:false` or
  `complete:false` and an explicit warning, including when cached results are mixed with misses. —
  `cli/test/markets.test.ts`, `cli/test/today.test.ts`, `cli/test/share.test.ts`,
  `mcp/test/market-completeness.test.ts`

Each property names the negative control that should make it fail. A property test that has not
been made to fail is pinning nothing, so every one of them was verified to go red with its rule
reverted.

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
- The East Asian display-width table is a hand-maintained list of ranges, because JavaScript
  regular expressions expose no `East_Asian_Width` property. It covers the planes that matter here
  and is not claimed to be exhaustive; a miss costs column alignment, not safety.
- Sanitizing normalizes what a *string* can contain, not what it can *say*. A provider that
  serves a plausible-looking team name is echoed as-is; only its shape is constrained.
- Removing bidi CONTROLS does not stop bidi reordering. Strong right-to-left characters — the
  letters of Arabic and Hebrew themselves — reorder their neighbours under the Unicode
  Bidirectional Algorithm with no control character involved, so a name in those scripts can still
  change how an adjacent scoreline reads. Refusing them is not an option: they are legitimate text.
  Both current providers serve Latin-script names, so nothing is reachable today; the structural
  mitigation, if a provider ever serves them, is to isolate each interpolated field (U+2066/U+2069)
  at the formatting layer rather than to filter the input.
- Stripping format characters also removes ZERO WIDTH NON-JOINER (U+200C), which is
  orthographic in Persian and several Indic scripts. Both current providers serve Latin-script
  names, so nothing is lost today; a future adapter serving native-script names would need a
  structural grammar for it, not a blanket carve-out.
- A label carries no emoji at all, so a name that legitimately contained one would lose it. That
  is the trade for having no exemption: while flags travelled through the text filter it needed an
  emoji carve-out, and a carve-out without its own grammar is a covert channel — tag characters map
  one-to-one onto printable ASCII, so one cluster can spell a sentence inside a single two-column
  glyph. Product glyphs are generated from the nation instead, which is why the carve-out could be
  removed rather than fenced.

## Supply chain

All three packages publish from CI with **npm provenance** via OIDC trusted publishing — there
is no long-lived npm token. GitHub Actions are pinned to full commit SHAs (not tags), including
in the workflow that holds the publishing credential. Dependency updates and security alerts run
through Dependabot.

---

Claudinho is an independent, open-source fan project. **Not affiliated with, endorsed by, or
connected to FIFA or Anthropic.**
