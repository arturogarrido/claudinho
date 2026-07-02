/**
 * Builds the Claudinho MCP server: tools, resources, and prompts wired to the
 * pure handlers in tools.ts. The same server object works over stdio in Claude
 * Code, Cursor, Codex, and any other MCP client.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
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
    .describe('Locale for formatting: en, es, pt, fr (other locales fall back to en)'),
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

const todayOut = {
  date: z.string(),
  degraded: z.boolean(),
  source: src,
  count: z.number(),
  matches: z.array(matchOut),
  marketSignals: z.record(anyObj).optional(),
};
const liveOut = { degraded: z.boolean(), source: src, count: z.number(), matches: z.array(matchOut) };
const matchDetailOut = {
  match: matchOut.nullable(),
  degraded: z.boolean().optional(),
  source: src.optional(),
  marketSignal: anyObj.nullable().optional(),
};
const standingsOut = {
  degraded: z.boolean(),
  source: src,
  tables: z.union([anyObj, z.array(anyObj), z.null()]),
};
const bracketOut = {
  view: anyObj.nullable(),
  degraded: z.boolean().optional(),
  standingsDegraded: z.boolean().optional(),
  source: src.optional(),
};
const nextOut = { team: z.string(), fixture: matchOut.nullable(), degraded: z.boolean() };
const marketOut = {
  matchId: z.string().nullable().optional(),
  team: z.string().optional(),
  date: z.string().optional(),
  degraded: z.boolean().optional(),
  informationalOnly: z.boolean(),
  signal: anyObj.nullable().optional(),
  signals: z.array(anyObj).optional(),
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
function toContent(r: ToolResult) {
  return {
    content: [
      { type: 'text' as const, text: r.text },
      { type: 'text' as const, text: '```json\n' + JSON.stringify(r.data, null, 2) + '\n```' },
    ],
    structuredContent: r.data as Record<string, unknown>,
  };
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
        "All fixtures for a date (default: today), with live score and minute overlaid on any match in play. Use this for a whole day's card; for only in-play matches use get_live, for one team's match use get_next_fixture, for a single match's detail use get_match. Kickoffs render in tz; lang localizes text (en/es/pt/fr); flavor sets commentary tone.",
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
        "One match by its id, with live score/minute overlaid when it's in play. Get the id from get_today or get_live; to find a team's match without an id, use get_next_fixture. tz/lang/flavor affect formatting.",
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
        'Live cumulative group standings — pass a group letter A–L, or omit for all 12. Returns ranked rows (team, played, W/D/L, goal difference, points). Use get_today for fixtures/scores and get_next_fixture for one team. Falls back to a roster at zero (flagged degraded) if live standings are unavailable.',
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
        "Read-only prediction-market signals for a match (by id), a team's current-or-next fixture, or a date (default: today). Returns market-implied percentages with attribution. Shown only before and during a match — finished matches have no market read. Informational only — relay the numbers factually; do not add betting, trading, or 'value' advice, and do not invent links.",
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
        "A polished, copy-pasteable card (plain text) for a match (matchId), a team's next fixture (team), a group's standings table (group, e.g. \"A\"), the knockout bracket (bracket: true), a date (default: today), or live matches (live: true). Returns the ready-to-paste snippet plus structured data — hand the snippet text to the user verbatim. No links; it carries a non-affiliation disclaimer, and any market line stays informational only.",
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
