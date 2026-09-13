/**
 * Builds the Claudinho MCP server: tools, resources, and prompts wired to the
 * pure handlers in tools.ts. The same server object works over stdio in Claude
 * Code, Cursor, Codex, and any other MCP client.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { types as utilTypes } from 'node:util';
// zod 4's bundled zod-3 entry point, on purpose: the SDK converts a zod-3 schema
// with zod-to-json-schema and a zod-4 schema with zod 4's own emitter, and the
// two differ (input objects lose `additionalProperties: false`, `$ref`s are
// inlined, records gain `propertyNames`, `$schema` moves) — 710 changed lines of
// tools/list, i.e. an MCP-affecting release. Through `zod/v3` every advertised
// schema stays byte-identical. Moving the declarations to zod 4 classic is a
// deliberate, MCP-affecting migration, not a dependency bump.
import { z } from 'zod/v3';
import {
  allFixtures,
  asFlavorLevel,
  fixturesByDate,
  groups,
  isValidDate,
  makeAdapter,
} from '@claudinho/core';
import { DISCLAIMER, matchList } from './format';
import {
  standingsResourceText,
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetStandings,
  toolGetBracket,
  toolGetTeam,
  toolGetToday,
  type ToolResult,
} from './tools';

export const SERVER_NAME = 'claudinho';
// Injected from package.json at build time (tsup `define`); falls back when run
// unbuilt (e.g. tests). Single source of truth: packages/mcp/package.json.
export const SERVER_VERSION = process.env.CLAUDINHO_VERSION ?? '0.0.0-dev';

// Default-on commentary voice. Gated by CLAUDINHO_FLAVOR (off|subtle|full).
const VOICE =
  asFlavorLevel(process.env.CLAUDINHO_FLAVOR) === 'off'
    ? ''
    : `\nVoice: when relaying scores, narrate with lively, regionally-appropriate football-commentary energy in the user's language. Each match line may end with a short exclamation ("— ¡GOOOOL!") — use it as a tone cue. Keep every fact exact; never invent details and never impersonate or name a real commentator.`;

const INSTRUCTIONS = `Claudinho serves live scores, fixtures, and group standings for the 2026 men's football tournament.
The team-taking tools (get_next_fixture, get_market_signal, get_share_snippet) expect a 3-letter code (e.g. MEX). When the user gives a nation NAME, call get_team FIRST to resolve it — get_team is fuzzy ("Mexico", "DR Congo", "Türkiye"), offline, and returns candidates when the name is ambiguous.
Use get_live during matches, get_today for a day's schedule, get_next_fixture for a specific team, get_standings for group tables, and get_bracket for the knockout tree.
Use get_market_signal for read-only prediction-market signals (a match, a team's current-or-next fixture, or a date). Market data is informational only — relay the percentages factually and never frame it as betting or trading advice.
Use get_share_snippet to produce a ready-to-paste match card (for a match, a team's next fixture, a date, or live matches) — hand the user the returned snippet text verbatim.${VOICE}
${DISCLAIMER}`;

// Tightened, reusable input schemas (exported for tests). Rejecting bad input
// at the schema boundary gives clients accurate hints and avoids silent
// fallback to defaults for invalid values.
export const dateArg = z
  .string()
  .refine(isValidDate, 'must be a real calendar date in YYYY-MM-DD form');
export const groupArg = z.string().regex(/^[A-La-l]$/, 'a group letter A–L');
export const teamArg = z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter team code, e.g. MEX');
export const flavorArg = z.enum(['off', 'subtle', 'full']);

// Shared optional args every tool accepts.
const commonArgs = {
  tz: z.string().optional().describe('IANA timezone for kickoff times, e.g. America/Mexico_City'),
  lang: z
    .string()
    .optional()
    .describe(
      'Locale for dates, provider attribution, and commentary: en, es, pt, fr (the summary scaffold stays English; other locales fall back to en)',
    ),
  flavor: flavorArg.optional().describe('Commentary flair: off, subtle, full (default: full)'),
};

// ---- Output schemas (structured tool output) --------------------------------
// Declared per tool so clients know each tool's return shape (and the .mcpb
// manifest carries it). Deliberately PERMISSIVE: `.passthrough()` on objects so
// no field is stripped and forward-compatible additions never break validation;
// every branch-specific key is optional. Domain types live in @claudinho/core as
// TS interfaces, so these are hand-mirrored (kept loose on purpose).
const teamRef = z.object({ code: z.string(), name: z.string(), flag: z.string() }).partial().passthrough();
const scorePair = z.object({ home: z.number(), away: z.number() }).partial().passthrough();
const matchOut = z
  .object({
    id: z.string(),
    stage: z.string().optional(),
    group: z.string().nullable().optional(),
    kickoff: z.string().optional(),
    venue: z.string().optional(),
    home: teamRef.optional(),
    away: teamRef.optional(),
    score: scorePair.nullable().optional(),
    shootout: scorePair.optional(),
    status: z.string().optional(),
    minute: z.number().nullable().optional(),
    winnerCode: z.string().optional(),
  })
  .passthrough();
const anyObj = z.object({}).passthrough();
const src = z.string().nullable();
const responseMeta = {
  responseTruncated: z.boolean().optional(),
  responseTruncation: z.string().optional(),
};

const todayOut = {
  date: z.string(),
  degraded: z.boolean(),
  source: src,
  // `count` is the TRUE total and `matches` may be a bounded view of it, so the
  // payload states whether it was cut rather than leaving a consumer to infer
  // it from two numbers.
  count: z.number(),
  truncated: z.boolean(),
  matches: z.array(matchOut),
  marketSignals: z.record(anyObj).optional(),
  marketComplete: z
    .boolean()
    .optional()
    .describe('False when optional market enrichment did not check every relevant fixture'),
  ...responseMeta,
};
const liveOut = {
  degraded: z.boolean(),
  source: src,
  count: z.number(),
  truncated: z.boolean(),
  matches: z.array(matchOut),
  ...responseMeta,
};
const matchDetailOut = {
  match: matchOut.nullable(),
  degraded: z.boolean().optional(),
  source: src.optional(),
  marketSignal: anyObj.nullable().optional(),
  marketComplete: z
    .boolean()
    .optional()
    .describe('False when optional market enrichment did not check this fixture'),
  ...responseMeta,
};
const standingsOut = {
  degraded: z.boolean(),
  source: src,
  tables: z.union([anyObj, z.array(anyObj), z.null()]),
  ...responseMeta,
};
const bracketOut = {
  view: anyObj.nullable(),
  degraded: z.boolean().optional(),
  standingsDegraded: z.boolean().optional(),
  source: src.optional(),
  ...responseMeta,
};
const nextOut = {
  team: z.string(),
  fixture: matchOut.nullable(),
  degraded: z.boolean(),
  source: src,
  ...responseMeta,
};
const marketOut = {
  matchId: z.string().nullable().optional(),
  team: z.string().optional(),
  date: z.string().optional(),
  degraded: z.boolean().optional(),
  informationalOnly: z.boolean(),
  signal: anyObj.nullable().optional(),
  signals: z.array(anyObj).optional(),
  // Present on the list-shaped branches: the TRUE total and whether the array
  // beside it was capped, so a consumer reading only `structuredContent` can
  // tell a complete list from a truncated one.
  count: z.number().optional(),
  truncated: z.boolean().optional(),
  complete: z
    .boolean()
    .optional()
    .describe('False when the market provider did not complete every relevant read'),
  ...responseMeta,
};
const shareOut = {
  kind: z.string(),
  target: z.string().optional(),
  snippet: z.string().optional(), // absent on the bracket "unknown stage" error branch
  source: src.optional(),
  informationalOnly: z.boolean().optional(),
  degraded: z.boolean().optional(),
  style: z.string().optional(),
  team: z.string().optional(),
  group: z.string().optional(),
  stage: z.string().optional(),
  tables: z.union([anyObj, z.array(anyObj), z.null()]).optional(),
  view: anyObj.nullable().optional(),
  matches: z.array(matchOut).optional(),
  marketSignals: z.record(anyObj).optional(),
  marketComplete: z
    .boolean()
    .optional()
    .describe('False when optional market enrichment did not check every relevant fixture'),
  count: z.number().optional(),
  truncated: z.boolean().optional(),
  ...responseMeta,
};
const teamInfo = z
  .object({ code: z.string(), name: z.string(), flag: z.string(), group: z.string() })
  .partial()
  .passthrough();
const teamOut = {
  query: z.string(),
  team: teamInfo.nullable(),
  matches: z.array(teamInfo),
  count: z.number(),
  ...responseMeta,
};

/**
 * The per-tool output shapes, keyed by tool name (exported so a test can
 * validate that every handler's `data` — healthy AND degraded — parses against
 * the schema the tool advertises). Keep in lockstep with the registerTool calls.
 */
export const OUTPUT_SCHEMAS = {
  get_today: todayOut,
  get_live: liveOut,
  get_match: matchDetailOut,
  get_standings: standingsOut,
  get_bracket: bracketOut,
  get_next_fixture: nextOut,
  get_market_signal: marketOut,
  get_share_snippet: shareOut,
  get_team: teamOut,
} as const;

/**
 * Wrap a ToolResult into the MCP tool response shape.
 *
 * We emit the payload BOTH as `structuredContent` (schema-validated, for clients
 * that support it) AND as a JSON block inside `content` — deliberately, not by
 * oversight. MCP's backwards-compat guidance is that a tool with an outputSchema
 * SHOULD still serialize the same data into a text block, so clients that don't
 * read `structuredContent` (older/simple ones) still get the structured data.
 * The redundancy costs a few tokens for agents that read both; dropping the text
 * block would silently blind those older clients to everything but the prose.
 */
/**
 * Ceiling on one tool response, in characters of serialized JSON.
 *
 * The record COUNT is bounded (40) and every field is bounded, but neither
 * bounds their product: 40 maximal fixtures whose `events` arrays are full can
 * still serialize to megabytes, and this is model context on every call. The
 * hook already learned this — bounding each field and the record count is not
 * the same as bounding the sum. A real response is a few KB.
 *
 * Applied at the ONE place every tool's payload leaves the server, rather than
 * per handler, so a tool added later cannot forget it.
 */
export const MAX_RESPONSE_CHARS = 128_000;

const RESPONSE_TRUNCATION =
  'Optional response detail was truncated to stay within the MCP context limit.';

/**
 * Shrink a payload until it fits, whatever SHAPE it has.
 *
 * The first version special-cased a top-level `matches` array, which meant the
 * bracket, standings and share shapes walked straight past it — a 300 KB share
 * snippet was returned in full. Bounding the shape you thought of is not
 * bounding the payload.
 *
 * Generic, in increasing order of damage: drop optional `events` detail,
 * truncate long strings, then shorten arrays. Every tool schema declares the
 * response metadata added after a successful shrink. If none of those
 * schema-preserving passes fits, `toContent` returns a bounded explicit error
 * without `structuredContent` instead of fabricating a schema-invalid shape.
 */
const SHRINK_FAILED = Symbol('shrink-failed');

/**
 * Work budget applied before JSON.stringify or the recursive shrink passes.
 * Real responses are far below these ceilings; they allow the largest tested
 * fixture/event response while refusing shapes whose inspection alone could
 * monopolize the long-running MCP server.
 */
const MAX_INSPECTION_DEPTH = 64;
const MAX_INSPECTION_ARRAY_LENGTH = 4_096;
const MAX_INSPECTION_KEYS_PER_OBJECT = 1_024;
const MAX_INSPECTION_ENTRIES = 65_536;
const MAX_INSPECTION_CONTAINERS = 16_384;
const MAX_INSPECTION_CHARS = 2_000_000;

type InspectionFrame =
  | { readonly value: unknown; readonly depth: number; readonly exit?: false }
  | { readonly value: object; readonly depth: number; readonly exit: true };

/**
 * Prove that measuring and shrinking this value have bounded work.
 *
 * This is iterative so a 50,000-level object cannot overflow the stack. It
 * reads data descriptors rather than property values, so accessors are refused
 * without executing attacker-controlled getters. The ancestor set detects
 * cycles but permits shared subtrees, matching JSON.stringify's behavior while
 * charging each serialized occurrence to the aggregate budgets.
 */
function withinInspectionBudget(root: unknown): boolean {
  const stack: InspectionFrame[] = [{ value: root, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let containers = 0;
  let entries = 0;
  let chars = 0;

  try {
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.exit) {
        ancestors.delete(frame.value);
        continue;
      }
      const { value, depth } = frame;
      if (typeof value === 'string') {
        chars += value.length;
        if (chars > MAX_INSPECTION_CHARS) return false;
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if (depth >= MAX_INSPECTION_DEPTH || ancestors.has(value)) return false;
      // A Proxy can change its descriptors between preflight and stringify, or
      // make `ownKeys` allocate an unbounded list before a loop can stop.
      if (utilTypes.isProxy(value)) return false;
      containers += 1;
      if (containers > MAX_INSPECTION_CONTAINERS) return false;

      const proto = Object.getPrototypeOf(value);
      const expectedProto = Array.isArray(value) ? Array.prototype : Object.prototype;
      if (proto !== expectedProto && proto !== null) return false;
      if (
        Object.getOwnPropertyDescriptor(value, 'toJSON') ||
        (proto && Object.getOwnPropertyDescriptor(proto, 'toJSON'))
      ) {
        return false;
      }

      ancestors.add(value);
      stack.push({ value, depth, exit: true });

      if (Array.isArray(value)) {
        if (value.length > MAX_INSPECTION_ARRAY_LENGTH) return false;
        entries += value.length;
        if (entries > MAX_INSPECTION_ENTRIES) return false;
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor) continue; // JSON serializes a hole as null.
          if (!('value' in descriptor)) return false;
          stack.push({ value: descriptor.value, depth: depth + 1 });
        }
        continue;
      }

      let keys = 0;
      for (const key in value as Record<string, unknown>) {
        keys += 1;
        if (keys > MAX_INSPECTION_KEYS_PER_OBJECT) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        if (!('value' in descriptor)) return false;
        entries += 1;
        chars += key.length;
        if (entries > MAX_INSPECTION_ENTRIES || chars > MAX_INSPECTION_CHARS) return false;
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
    return true;
  } catch {
    // Proxies and exotic objects can throw from reflection. Tool data is plain
    // structured data; an uninspectable shape takes the explicit error path.
    return false;
  }
}

function shrink(
  value: unknown,
  pass: 1 | 2 | 3,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown | typeof SHRINK_FAILED {
  // A schema-preserving shrink may shorten strings/arrays or remove the
  // optional match `events` detail. It may not replace a required nested value
  // with null merely to fit. Deep/cyclic shapes therefore take the explicit
  // bounded-error path in `toContent`.
  if (depth >= 64) return SHRINK_FAILED;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return SHRINK_FAILED;
    ancestors.add(value);
    const items = pass === 3 ? value.slice(0, 8) : value;
    const out: unknown[] = [];
    for (const item of items) {
      const shrunk = shrink(item, pass, depth + 1, ancestors);
      if (shrunk === SHRINK_FAILED) return SHRINK_FAILED;
      out.push(shrunk);
    }
    ancestors.delete(value);
    return out;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return SHRINK_FAILED;
    ancestors.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'events') continue; // always the first thing to go
      const shrunk = shrink(v, pass, depth + 1, ancestors);
      if (shrunk === SHRINK_FAILED) return SHRINK_FAILED;
      out[k] = shrunk;
    }
    ancestors.delete(value);
    return out;
  }
  if (typeof value === 'string') {
    if (pass >= 2 && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  }
  return value;
}

/**
 * Serialized size, or Infinity if it cannot even be measured.
 *
 * `JSON.stringify` THROWS `RangeError: Invalid string length` past V8's maximum
 * string length, and on a cycle. Measuring was the one step assumed safe, so a
 * big enough payload did not return over-budget — it crashed the tool call.
 * Unmeasurable is treated as "too big", which routes it to the harsher pass.
 */
function size(v: unknown): number {
  try {
    return JSON.stringify(v ?? null)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function boundResponse(data: unknown): unknown {
  if (!withinInspectionBudget(data)) return null;
  if (size(data) <= MAX_RESPONSE_CHARS) return data;
  // Every declared tool output is an object. Spreading a top-level array into
  // numeric object keys would fit the byte cap by violating that contract.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  for (const pass of [1, 2, 3] as const) {
    const candidate = shrink(data, pass);
    if (
      candidate === SHRINK_FAILED ||
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const marked = {
      ...(candidate as Record<string, unknown>),
      responseTruncated: true,
      responseTruncation: RESPONSE_TRUNCATION,
    };
    if (size(marked) <= MAX_RESPONSE_CHARS) return marked;
  }
  // `null` is an internal sentinel: `toContent` turns it into a small explicit
  // MCP error and omits structuredContent, so no invalid output-schema skeleton
  // is ever handed to the SDK.
  return null;
}

/** Ceiling on the prose block, which is model context too and was never bounded. */
const MAX_TEXT_CHARS = 32_000;

/**
 * Above this, the JSON text block is dropped rather than duplicating
 * `structuredContent`. Comfortably larger than any real response.
 */
const DUAL_EMIT_LIMIT = 16_000;

export function toContent(r: ToolResult) {
  const data = boundResponse(r.data);
  const dataTruncated =
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).responseTruncated === true;
  const marker = dataTruncated ? `\n\n(${RESPONSE_TRUNCATION})` : '';
  const room = Math.max(0, MAX_TEXT_CHARS - marker.length - '\n(truncated)'.length);
  const text =
    r.text.length > room
      ? `${r.text.slice(0, room)}\n(truncated)${marker}`
      : r.text + marker;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error =
      'Response data exceeded the MCP context limit and could not be reduced without violating its output schema.';
    return {
      content: [
        {
          type: 'text' as const,
          text: `${text.slice(0, Math.max(0, MAX_TEXT_CHARS - error.length - 2))}\n\n${error}`,
        },
      ],
      isError: true,
    };
  }
  // The JSON text block DUPLICATES `structuredContent`; that dual-emit is
  // deliberate, so clients too old to read structuredContent still get the data
  // (see the note above). But duplicating a large payload doubles the context
  // for a compatibility case, so past a threshold the block is dropped and the
  // prose carries it — modern clients read structuredContent regardless.
  const compact = JSON.stringify(data);
  const content = [{ type: 'text' as const, text }];
  if (compact.length <= DUAL_EMIT_LIMIT) {
    content.push({
      type: 'text' as const,
      text: '```json\n' + JSON.stringify(data, null, 2) + '\n```',
    });
  }
  return { content, structuredContent: data as Record<string, unknown> };
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  // ---- Tools ----
  server.registerTool(
    'get_today',
    {
      title: "Today's matches",
      description:
        "All fixtures for a date (default: today), with live score and minute overlaid on any match in play. Optional prediction-market enrichment carries marketComplete; false means the read was incomplete, not that no signal exists. Use this for a whole day's card; for only in-play matches use get_live, for one team's match use get_next_fixture, for a single match's detail use get_match. Kickoffs render in tz; lang localizes dates, attribution, and commentary (en/es/pt/fr); flavor sets commentary tone.",
      inputSchema: {
        date: dateArg.optional().describe('Date as YYYY-MM-DD (default: today)'),
        ...commonArgs,
      },
      // Read-only; reaches an external data provider for the live overlay.
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: todayOut,
    },
    async (args) => toContent(await toolGetToday(args)),
  );

  server.registerTool(
    'get_live',
    {
      title: 'Live matches',
      description:
        'Only matches in play right now — each with current score and minute (empty when nothing is live). Use during matches for in-play state; for a full day\'s schedule including upcoming and finished, use get_today. tz/lang/flavor affect formatting only.',
      inputSchema: { ...commonArgs },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: liveOut,
    },
    async (args) => toContent(await toolGetLive(args)),
  );

  server.registerTool(
    'get_match',
    {
      title: 'Match detail',
      description:
        "One match by its id, with live score/minute overlaid when it's in play. Optional prediction-market enrichment carries marketComplete; false means the read was incomplete, not that no signal exists. Get the id from get_today or get_live; to find a team's match without an id, use get_next_fixture. tz/lang/flavor affect formatting.",
      inputSchema: { id: z.string().describe('Match id'), ...commonArgs },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: matchDetailOut,
    },
    async (args) => toContent(await toolGetMatch(args)),
  );

  server.registerTool(
    'get_standings',
    {
      title: 'Group standings',
      description:
        'Live cumulative group standings — pass a group letter A–L, or omit for all 12. Returns ranked rows (team, played, W/D/L, goal difference, points). Use get_today for fixtures/scores and get_next_fixture for one team. If unavailable, the default World Cup scope returns a roster at zero; competitions without a compatible bundled roster return no tables. Both are flagged degraded.',
      inputSchema: {
        group: groupArg.optional().describe('Group letter A–L (omit for all)'),
        ...commonArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: standingsOut,
    },
    async (args) => toContent(await toolGetStandings(args)),
  );

  server.registerTool(
    'get_bracket',
    {
      title: 'Knockout bracket',
      description:
        'Knockout bracket from the Round of 32 through the final, with live scores overlaid. Group slots project from live standings once a group has started; winner slots need a confirmed FT result. Pass an optional stage (R32, R16, QF, SF, 3P, F) to filter one round. Falls back to structure-only when live data is unavailable.',
      inputSchema: {
        stage: z
          .enum(['R32', 'R16', 'QF', 'SF', '3P', 'F'])
          .optional()
          .describe('Knockout round to show (omit for the full bracket)'),
        ...commonArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: bracketOut,
    },
    async (args) => toContent(await toolGetBracket(args)),
  );

  server.registerTool(
    'get_next_fixture',
    {
      title: 'Next fixture for a team',
      description:
        "A team's next match, live-resolved: a confirmed knockout tie (Round of 32 onward) is read from the live overlay, group fixtures from the bundled schedule. Use a 3-letter code, e.g. MEX, BRA, USA. Falls back to the bundled schedule if the provider is unreachable.",
      inputSchema: { team: teamArg.describe('3-letter team code, e.g. MEX'), ...commonArgs },
      // Read-only; overlays live provider data for knockout pairings, so open-world.
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: nextOut,
    },
    async (args) => toContent(await toolGetNextFixture(args)),
  );

  server.registerTool(
    'get_market_signal',
    {
      title: 'Prediction-market signal',
      description:
        "Read-only prediction-market signals for a match (by id), a team's current-or-next fixture, or a date (default: today). Returns market-implied percentages with attribution; complete:false means the provider read was incomplete, not that no signal exists. Shown only before and during a match — finished matches have no market read. Informational only — relay the numbers factually; do not add betting, trading, or 'value' advice, and do not invent links.",
      inputSchema: {
        matchId: z.string().optional().describe('Match id (most specific)'),
        team: teamArg
          .optional()
          .describe(
            "3-letter team code, e.g. MEX — resolves to the team's in-play match when one is live, else their next fixture",
          ),
        date: dateArg
          .optional()
          .describe("Date as YYYY-MM-DD (default: today) for all that day's signals"),
        ...commonArgs,
      },
      // Read-only; reaches an external prediction-market data provider.
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: marketOut,
    },
    async (args) => toContent(await toolGetMarketSignal(args)),
  );

  server.registerTool(
    'get_share_snippet',
    {
      title: 'Shareable match snippet',
      description:
        "A polished, copy-pasteable card (plain text) for a match (matchId), a team's next fixture (team), a group's standings table (group, e.g. \"A\"), the knockout bracket (bracket: true), a date (default: today), or live matches (live: true). Returns the ready-to-paste snippet plus structured data — hand the snippet text to the user verbatim. marketComplete:false is stated inside the card as an incomplete optional read. No links; it carries a non-affiliation disclaimer, and any market line stays informational only.",
      inputSchema: {
        matchId: z.string().optional().describe('Match id (most specific)'),
        team: teamArg
          .optional()
          .describe("3-letter team code for that team's next fixture, e.g. MEX"),
        group: groupArg.optional().describe('Group letter A–L for a standings card, e.g. A'),
        bracket: z.boolean().optional().describe('Knockout bracket card (use with optional knockoutStage)'),
        knockoutStage: z
          .enum(['R32', 'R16', 'QF', 'SF', '3P', 'F'])
          .optional()
          .describe('Filter the bracket card to one round'),
        date: dateArg.optional().describe('Date as YYYY-MM-DD (default: today)'),
        live: z.boolean().optional().describe('Snapshot of matches in play right now'),
        style: z
          .enum(['social', 'compact'])
          .optional()
          .describe('social (default, full card) or compact (one line per match)'),
        includeHashtag: z.boolean().optional().describe('Include the #VibingLaVidaLoca tag (default true)'),
        includeInstallLine: z.boolean().optional().describe('Include the "Try it: …" run cue (default true)'),
        includeMarkets: z
          .boolean()
          .optional()
          .describe('Include the reliable market line when available (default true)'),
        ...commonArgs,
      },
      // Read-only; may reach the live/market data providers (live/today/match).
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: shareOut,
    },
    async (args) => toContent(await toolGetShareSnippet(args)),
  );

  server.registerTool(
    'get_team',
    {
      title: 'Resolve a team',
      description:
        "Resolve a nation name or 3-letter code to its FIFA code, flag, and group. Fuzzy and forgiving: accepts \"Mexico\", \"mex\", \"USA\", \"DR Congo\", \"Türkiye\"/\"Turkey\", \"Holland\", etc. Use this FIRST to turn a user's team name into the code the other tools need (get_next_fixture, get_standings, get_market_signal, get_share_snippet). Returns the single confident match (team), plus candidates (matches) when the query is ambiguous (e.g. \"south\" → South Africa, South Korea). Offline — reads the bundled roster, never the network.",
      inputSchema: {
        query: z.string().describe('Team name or 3-letter code, e.g. "Mexico", "MEX", "DR Congo"'),
      },
      // Read-only AND offline — resolves against the bundled roster, no provider call.
      annotations: { readOnlyHint: true, openWorldHint: false },
      outputSchema: teamOut,
    },
    async (args) => toContent(toolGetTeam(args)),
  );

  // ---- Resources ----
  // Group standings as a readable table: standings://A
  server.registerResource(
    'standings',
    new ResourceTemplate('standings://{group}', { list: undefined }),
    {
      title: 'Group standings',
      description: 'Live group table for a group letter A–L.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const group = String(variables.group ?? '');
      // Shares the get_standings path → live standings, fail-closed roster, and
      // the SAME provider attribution + disclaimer.
      const text = await standingsResourceText(group, makeAdapter());
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    },
  );

  // Fixtures for a date: fixtures://2026-06-11
  server.registerResource(
    'fixtures',
    new ResourceTemplate('fixtures://{date}', { list: undefined }),
    {
      title: 'Fixtures by date',
      // A resource URI has no timezone, so group by UTC for a stable, machine-
      // independent result. (The get_today tool groups by the caller's tz.)
      description: 'Static fixture list for a UTC date (YYYY-MM-DD).',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const date = String(variables.date ?? '');
      const text = matchList(fixturesByDate(date, undefined, 'UTC'), `No matches on ${date}.`);
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    },
  );

  // ---- Prompts ----
  server.registerPrompt(
    'tournament_today',
    {
      title: "Today's tournament summary",
      description: "Summarize today's matches and what to watch.",
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: "Use the get_today and get_live tools to summarize today's football matches in the 2026 tournament. Highlight any matches in play, then list the rest with kickoff times in my timezone.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'my_team',
    {
      title: 'My team',
      description: "Focus on one team's next match, group situation, and the prediction-market read.",
      argsSchema: { team: teamArg.describe('3-letter team code, e.g. MEX') },
    },
    ({ team }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Using get_next_fixture, get_standings, and get_market_signal, tell me about ${team}'s next match in the 2026 tournament, their current group standing, and what prediction markets currently say about that match. Always state each fixture's date so a market read is never mistaken for a different match. Treat the market percentages as informational context only — relay them factually, never as betting or trading advice.`,
          },
        },
      ],
    }),
  );

  return server;
}

/** Count of bundled fixtures — a cheap startup sanity check. */
export function fixtureCount(): number {
  return allFixtures().length;
}

/** Distinct group letters (sanity/diagnostics). */
export function groupLetters(): string[] {
  return groups();
}
