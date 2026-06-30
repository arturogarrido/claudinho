#!/usr/bin/env bash
#
# release-qa.sh — render EVERY user-facing surface against the live feed, across
# timezones + all four locales, for a human eyeball BEFORE tagging a release.
#
# Why this exists: the 0.8.0 -> 0.8.4 bracket sprawl was five releases because
# each gap (ambiguous dates, missing host-nation flags, a dropped tz on MCP
# get_bracket) was found by *using* the feature after it was already live. This
# makes the "test it on a real terminal first" pass exhaustive and reproducible
# instead of ad-hoc greps. Its job is to put every surface in front of you — the
# eyeball is still yours. A few tripwires at the end encode the specific bugs that
# shipped this cycle so they can't recur silently.
#
# Usage:
#   pnpm -r build && ./scripts/release-qa.sh        # test the artifact about to ship
#   CLI="claudinho" ./scripts/release-qa.sh         # test the global install instead
#   CLAUDINHO_COMPETITION=fifa.friendly ./scripts/release-qa.sh   # another competition
#
# Exit code: non-zero if a tripwire FAILS (real regression). A degraded/unreachable
# feed downgrades tripwires to SKIP (exit 0) — a network blip must not block a release.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/packages/cli/dist/index.js"
CORE_DIST="$ROOT/packages/core/dist/index.js"
export CLAUDINHO_COMPETITION="${CLAUDINHO_COMPETITION:-fifa.world}"
LANGS=(en es pt fr)
TEAM="${TEAM:-MEX}"
GROUP="${GROUP:-A}"

# Default to the built dist (tests exactly what ships); CLI=claudinho overrides.
cli() { if [ -n "${CLI:-}" ]; then $CLI "$@"; else node "$DIST" "$@"; fi; }

bold()    { printf '\033[1m%s\033[0m\n' "$1"; }
banner()  { printf '\n\033[1;36m━━━ %s ━━━\033[0m\n' "$1"; }
run()     { printf '\033[2m$ claudinho %s\033[0m\n' "$*"; cli "$@"; echo; }

if [ -z "${CLI:-}" ] && [ ! -f "$DIST" ]; then
  echo "✗ build first:  pnpm -r build   (or run with CLI=claudinho)"; exit 1
fi

bold "release-qa · competition=$CLAUDINHO_COMPETITION · $(cli --version 2>/dev/null)"
echo "Read every section below. Then run the release. Tripwires summarized at the end."

# ── 1. The knockout bracket (the surface that sprawled) ──────────────────────
banner "BRACKET — list + tree (en)"
run bracket
run bracket --tree

banner "BRACKET — all four locales (team names stay EN by design; labels/dates localize)"
for L in "${LANGS[@]}"; do run bracket --lang "$L"; done

banner "BRACKET — timezone threading (date must land in the CALLER's zone, not server-local)"
run bracket --tz UTC
run bracket --tz Asia/Tokyo

# ── 2. Share bracket (pasteable, disclaimer non-optional) ────────────────────
banner "SHARE BRACKET — social + compact + a locale"
run share bracket
run share bracket --style compact
run share bracket --lang es

# ── 3. Day / score / standings surfaces ──────────────────────────────────────
banner "TODAY / LIVE (en + es spot-check)"
run today
run today --lang es
run live

banner "NEXT ($TEAM) / TABLE ($GROUP) / all tables"
run next "$TEAM"
run table "$GROUP"
run table

banner "SHARE — table + live"
run share table "$GROUP"
run share live

# ── 4. Statusline (reads the local micro-cache; may be quiet off-match) ───────
banner "STATUSLINE (prompt)"
run prompt

# ── 5. Tripwires — the specific bugs that shipped this cycle ──────────────────
banner "TRIPWIRES"
PASS=0; FAIL=0; SKIP=0
BR_EN="$(cli bracket 2>/dev/null)"
BR_UTC="$(cli bracket --tz UTC 2>/dev/null)"
BR_TYO="$(cli bracket --tz Asia/Tokyo 2>/dev/null)"
SB="$(cli share bracket 2>/dev/null)"
SBC="$(cli share bracket --style compact 2>/dev/null)"

check() { # name ; pass-condition already evaluated into $1=ok/no
  if [ "$1" = "ok" ]; then printf '  \033[32m✓ PASS\033[0m  %s\n' "$2"; PASS=$((PASS+1))
  else printf '  \033[31m✗ FAIL\033[0m  %s\n' "$2"; FAIL=$((FAIL+1)); fi
}

# If the feed is degraded/unreachable, the bracket loses its R32 structure — skip
# tripwires rather than fail a release on a transient network issue (fail-closed,
# never cache a transient error as a real result).
if ! grep -q "Round of 32" <<<"$BR_EN" || grep -qi "degraded\|feed.*down\|unreachable" <<<"$BR_EN"; then
  printf '  \033[33m⚠ SKIP\033[0m  feed degraded/unreachable — eyeball the sections above manually\n'
  SKIP=4
else
  # T1: bracket kickoffs show a CALENDAR DATE (month), not a bare weekday (0.8.4)
  grep -qE "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)" <<<"$BR_EN" \
    && check ok  "bracket kickoffs show a calendar month (unambiguous over the 3-week span)" \
    || check no  "bracket kickoffs show a calendar month (unambiguous over the 3-week span)"
  # T2: tz is actually threaded into the rendered date/time (0.8.4 MCP miss)
  [ "$BR_UTC" != "$BR_TYO" ] \
    && check ok  "bracket output differs UTC vs Asia/Tokyo (tz threaded into rendering)" \
    || check no  "bracket output differs UTC vs Asia/Tokyo (tz threaded into rendering)"
  # T3/T4: the non-affiliation disclaimer is non-optional on share cards (legal)
  grep -qi "not affiliated with FIFA" <<<"$SB" \
    && check ok  "share bracket carries the non-affiliation disclaimer" \
    || check no  "share bracket carries the non-affiliation disclaimer"
  grep -qi "not affiliated with FIFA" <<<"$SBC" \
    && check ok  "share bracket --style compact carries the disclaimer" \
    || check no  "share bracket --style compact carries the disclaimer"
fi

# T5 — DETERMINISTIC, feed-independent: a knockout decided on penalties renders the
# shootout score "1(3)–1(4)". Run on a synthetic fixture through the real share
# formatter (core `formatShareSnippet`, which every card routes through `scoreline`)
# so this regression class is proven even when the live feed degrades to SKIP above
# — the exact gap that hid the live penalty render in one review env. (v0.8.10)
# NOTE: this renders the LOCAL repo core formatter (what's about to ship via the
# normal `pnpm -r build && pnpm release:qa` path). In `CLI=claudinho` mode you're
# testing an already-published global, whose bundled formatter we can't import —
# so SKIP rather than claim a PASS that doesn't reflect the global install.
if [ -n "${CLI:-}" ]; then
  printf '  \033[33m⚠ SKIP\033[0m  penalty render check (CLI override tests a global install; tripwire renders the local core formatter)\n'
  SKIP=$((SKIP+1))
elif [ -f "$CORE_DIST" ]; then
  PENS="$(node --input-type=module -e "
import { formatShareSnippet } from 'file://$CORE_DIST';
const m = { id:'pk', stage:'R32', kickoff:'2026-06-30T18:00Z', venue:'X',
  home:{code:'GER',name:'Germany',flag:'🇩🇪'}, away:{code:'PAR',name:'Paraguay',flag:'🇵🇾'},
  status:'FT', score:{home:1,away:1}, shootout:{home:3,away:4}, updatedAt:'2026-06-30T21:00Z' };
process.stdout.write(formatShareSnippet({ title:'pens', matches:[m] }, {}));
" 2>/dev/null)"
  grep -q "1(3)–1(4)" <<<"$PENS" \
    && check ok  "penalty shootout renders 1(3)–1(4) (deterministic, feed-independent)" \
    || check no  "penalty shootout renders 1(3)–1(4) (deterministic, feed-independent)"
else
  printf '  \033[33m⚠ SKIP\033[0m  penalty render check (core dist not built — run pnpm -r build)\n'
  SKIP=$((SKIP+1))
fi

# T6 — DETERMINISTIC, feed-independent: the market gate must NOT render a cached
# signal against a degraded knockout placeholder. Market signals are cached by
# match id but display labels come from the CURRENT fixture, so when the feed
# degrades and a KO slot falls back to the bundle's 🏳️ placeholder (same id), a
# cached MEX/ECU signal could print "Group A Winner 43% · …". `marketSignalRendersFor`
# (matchId + mapsCleanly) is the chokepoint; assert it suppresses the mismatch
# and still passes the resolved fixture (positive control). (v0.8.12 review P1.)
if [ -n "${CLI:-}" ]; then
  printf '  \033[33m⚠ SKIP\033[0m  market-gate degraded check (CLI override tests a global install; tripwire imports the local core)\n'
  SKIP=$((SKIP+1))
elif [ -f "$CORE_DIST" ]; then
  GATE="$(node --input-type=module -e "
import { marketSignalRendersFor, buildMarketSignal, normalizeOutcomes } from 'file://$CORE_DIST';
const resolved = { id:'g', stage:'R32', kickoff:'2026-06-30T18:00Z', venue:'X',
  home:{code:'MEX',name:'Mexico',flag:'🇲🇽'}, away:{code:'ECU',name:'Ecuador',flag:'🇪🇨'},
  status:'SCHEDULED', updatedAt:'2026-06-30T00:00Z' };
const sig = buildMarketSignal({ match: resolved, source:'fake', asOf:'2026-06-30T11:55Z',
  outcomes: normalizeOutcomes([{kind:'home',teamCode:'MEX',label:'Mexico',probability:0.45},
    {kind:'draw',label:'Draw',probability:0.32},{kind:'away',teamCode:'ECU',label:'Ecuador',probability:0.23}]),
  now: new Date('2026-06-30T11:55Z') });
const placeholder = { ...resolved, home:{code:'2A',name:'Group A 2nd Place',flag:'🏳️'},
  away:{code:'2B',name:'Group B 2nd Place',flag:'🏳️'} };
const ok = marketSignalRendersFor(resolved, sig) === true && marketSignalRendersFor(placeholder, sig) === false;
process.stdout.write(ok ? 'GATE-OK' : 'GATE-LEAK');
" 2>/dev/null)"
  [ "$GATE" = "GATE-OK" ] \
    && check ok  "market gate suppresses a cached signal on a degraded placeholder (deterministic)" \
    || check no  "market gate suppresses a cached signal on a degraded placeholder (deterministic)"
else
  printf '  \033[33m⚠ SKIP\033[0m  market-gate degraded check (core dist not built — run pnpm -r build)\n'
  SKIP=$((SKIP+1))
fi

echo
bold "tripwires: $PASS passed · $FAIL failed · $SKIP skipped"
echo "NOTE: this covers CLI/share rendering. MCP arg-threading (tz/lang on get_bracket"
echo "et al.) is guarded by packages/mcp/test/tools.test.ts — keep that green too."
[ "$FAIL" -eq 0 ]
