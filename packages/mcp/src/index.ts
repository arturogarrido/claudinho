/**
 * Claudinho MCP server entry point. Connects the server over stdio — the
 * transport every MCP client (Claude Code, Cursor, Codex, …) speaks.
 *
 * Install:
 *   claude mcp add claudinho -- npx -y @claudinho/mcp
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Never write to stdout — it's the protocol channel. Logs go to stderr.
  process.stderr.write('claudinho-mcp: ready (stdio)\n');
}

main().catch((err) => {
  process.stderr.write(`claudinho-mcp: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
