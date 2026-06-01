/**
 * Builds the Claudinho MCP server: tools, resources, and prompts wired to the
 * pure handlers in tools.ts. The same server object works over stdio in Claude
 * Code, Cursor, Codex, and any other MCP client.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  allFixtures,
  computeStandings,
  fixturesByDate,
  fixturesByGroup,
  groups,
} from '@claudinho/core';
import { DISCLAIMER, matchList, standingsTable } from './format';
import {
  toolGetLive,
  toolGetMatch,
  toolGetNextFixture,
  toolGetStandings,
  toolGetToday,
  type ToolResult,
} from './tools';

export const SERVER_NAME = 'claudinho';
export const SERVER_VERSION = '0.0.0';

const INSTRUCTIONS = `Claudinho serves live scores, fixtures, and group standings for the 2026 men's football tournament.
Use get_live during matches, get_today for a day's schedule, get_next_fixture for a specific team (3-letter code, e.g. MEX), and get_standings for group tables.
${DISCLAIMER}`;

// Shared optional args every tool accepts.
const commonArgs = {
  tz: z.string().optional().describe('IANA timezone for kickoff times, e.g. America/Mexico_City'),
  lang: z.string().optional().describe('Locale for formatting, e.g. en, es, pt, fr'),
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
        date: z.string().optional().describe('Date as YYYY-MM-DD (default: today)'),
        ...commonArgs,
      },
      // Read-only; reaches an external data source (ESPN) for live overlay.
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
      description: 'Group table(s). Pass a group letter A–L, or omit for all groups.',
      inputSchema: {
        group: z.string().optional().describe('Group letter A–L (omit for all)'),
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
      description: "A team's next scheduled match. Use a 3-letter code, e.g. MEX, BRA, USA.",
      inputSchema: { team: z.string().describe('3-letter team code, e.g. MEX'), ...commonArgs },
      // Read-only and served entirely from the bundled static schedule.
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => toContent(await toolGetNextFixture(args)),
  );

  // ---- Resources ----
  // Group standings as a readable table: standings://A
  server.registerResource(
    'standings',
    new ResourceTemplate('standings://{group}', { list: undefined }),
    {
      title: 'Group standings',
      description: 'Static group table for a group letter A–L.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const group = String(variables.group ?? '').toUpperCase();
      const rows = computeStandings(fixturesByGroup(group));
      const text = rows.length ? standingsTable(group, rows) : `No group ${group}.`;
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    },
  );

  // Fixtures for a date: fixtures://2026-06-11
  server.registerResource(
    'fixtures',
    new ResourceTemplate('fixtures://{date}', { list: undefined }),
    {
      title: 'Fixtures by date',
      description: 'Static fixture list for a date (YYYY-MM-DD).',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const date = String(variables.date ?? '');
      const text = matchList(fixturesByDate(date), `No matches on ${date}.`);
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
      description: "Focus on one team's next match and group situation.",
      argsSchema: { team: z.string().describe('3-letter team code, e.g. MEX') },
    },
    ({ team }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Using get_next_fixture and get_standings, tell me about ${team}'s next match in the 2026 tournament and their current group standing.`,
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
