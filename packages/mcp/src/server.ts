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
  getStandings,
  groups,
  isValidDate,
  makeAdapter,
} from '@claudinho/core';
import { DISCLAIMER, matchList, standingsTable } from './format';
import {
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetStandings,
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
Use get_live during matches, get_today for a day's schedule, get_next_fixture for a specific team (3-letter code, e.g. MEX), and get_standings for group tables.
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

/** Wrap a ToolResult into the MCP tool response shape. */
function toContent(r: ToolResult) {
  return {
    content: [
      { type: 'text' as const, text: r.text },
      { type: 'text' as const, text: '```json\n' + JSON.stringify(r.data, null, 2) + '\n```' },
    ],
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
      description: "Fixtures for a given date (default: today), with live scores overlaid.",
      inputSchema: {
        date: dateArg.optional().describe('Date as YYYY-MM-DD (default: today)'),
        ...commonArgs,
      },
      // Read-only; reaches an external data provider for the live overlay.
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toContent(await toolGetToday(args)),
  );

  server.registerTool(
    'get_live',
    {
      title: 'Live matches',
      description: 'Matches currently in play, with score and minute.',
      inputSchema: { ...commonArgs },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => toContent(await toolGetLive(args)),
  );

  server.registerTool(
    'get_match',
    {
      title: 'Match detail',
      description: 'A single match by its id, with live state if available.',
      inputSchema: { id: z.string().describe('Match id'), ...commonArgs },
      annotations: { readOnlyHint: true, openWorldHint: true },
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
    },
    async (args) => toContent(await toolGetStandings(args)),
  );

  server.registerTool(
    'get_next_fixture',
    {
      title: 'Next fixture for a team',
      description:
        "A team's next scheduled match. Use a 3-letter code, e.g. MEX, BRA, USA. Instant and offline — answered from the bundled schedule, no network.",
      inputSchema: { team: teamArg.describe('3-letter team code, e.g. MEX'), ...commonArgs },
      // Read-only and served entirely from the bundled static schedule.
      annotations: { readOnlyHint: true, openWorldHint: false },
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
    },
    async (args) => toContent(await toolGetMarketSignal(args)),
  );

  server.registerTool(
    'get_share_snippet',
    {
      title: 'Shareable match snippet',
      description:
        "A polished, copy-pasteable card (plain text) for a match (matchId), a team's next fixture (team), a group's standings table (group, e.g. \"A\"), a date (default: today), or live matches (live: true). Returns the ready-to-paste snippet plus structured data — hand the snippet text to the user verbatim. No links; it carries a non-affiliation disclaimer, and any market line stays informational only.",
      inputSchema: {
        matchId: z.string().optional().describe('Match id (most specific)'),
        team: teamArg
          .optional()
          .describe("3-letter team code for that team's next fixture, e.g. MEX"),
        group: groupArg.optional().describe('Group letter A–L for a standings card, e.g. A'),
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
    },
    async (args) => toContent(await toolGetShareSnippet(args)),
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
      const group = String(variables.group ?? '').toUpperCase();
      // Authoritative live standings; fails closed to a degraded roster.
      const { tables, degraded } = await getStandings(makeAdapter(), group);
      const tb = tables[0];
      let text = tb ? standingsTable(tb.group, tb.rows) : `No group ${group}.`;
      if (degraded && tb) text += '\n\n(Live standings unavailable — showing the group roster.)';
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
