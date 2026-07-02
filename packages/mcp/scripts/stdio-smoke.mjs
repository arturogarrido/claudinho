#!/usr/bin/env node
/**
 * Real-stdio smoke test for the built MCP server — the transport every install
 * channel actually uses (Registry/Smithery/Cursor launch `node dist/index.js`
 * over stdio) but vitest never exercises (it imports handlers in-process).
 * Spawns the dist, performs the MCP handshake, lists tools (every one must
 * declare an outputSchema), and calls the offline `get_team` tool end-to-end.
 * No network. Exits non-zero on any mismatch.
 *
 *   pnpm -F @claudinho/mcp smoke:stdio   (CI runs it on Node 22/24 and the Node-20 floor)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// argv[2] overrides the server entry — used to verify this guard itself trips
// (e.g. against a wrapper that pollutes stdout before delegating to the dist).
const entry = process.argv[2] ? resolve(process.argv[2]) : join(pkgDir, 'dist', 'index.js');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

if (!existsSync(entry)) {
  console.error('✗ dist/index.js not found — run `pnpm -F @claudinho/mcp build` first.');
  process.exit(1);
}

const req = (id, method, params) =>
  `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
const input =
  req(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'stdio-smoke', version: '1' },
  }) +
  `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n` +
  req(2, 'tools/list', {}) +
  req(3, 'tools/call', { name: 'get_team', arguments: { query: 'mexico' } });

let out = '';
try {
  out = execFileSync(process.execPath, [entry], { input, encoding: 'utf8', timeout: 30_000 });
} catch (e) {
  out = String(e.stdout ?? ''); // stdin EOF may exit non-zero after the replies were written
}

const fail = (msg) => {
  console.error(`✗ stdio smoke: ${msg}`);
  process.exit(1);
};

// stdout of a stdio MCP server must be PURE JSON-RPC — any other line (a boot
// banner, a stray console.log) breaks strict clients. Logs belong on stderr
// (the server's "ready" banner correctly goes there). Fail loudly on any
// non-empty stdout line that isn't a JSON-RPC 2.0 message, instead of
// swallowing it and passing on the replies that happened to parse.
const byId = {};
const garbage = [];
for (const line of out.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    garbage.push(trimmed);
    continue;
  }
  if (msg?.jsonrpc !== '2.0') {
    garbage.push(trimmed);
    continue;
  }
  if (msg.id !== undefined) byId[msg.id] = msg;
}
if (garbage.length) {
  fail(
    `stdout is not pure JSON-RPC — a stdio MCP server must keep stdout protocol-clean (log to stderr). Offending line(s):\n   ${garbage
      .slice(0, 5)
      .map((l) => l.slice(0, 200))
      .join('\n   ')}`,
  );
}

const init = byId[1]?.result;
if (!init) fail('no initialize response over stdio');
if (init.serverInfo?.name !== 'claudinho')
  fail(`serverInfo.name is ${JSON.stringify(init.serverInfo?.name)}, expected "claudinho"`);
if (init.serverInfo?.version !== pkg.version)
  fail(
    `server reports v${init.serverInfo?.version} but package.json says v${pkg.version} — stale dist? rebuild`,
  );

const tools = byId[2]?.result?.tools ?? [];
if (tools.length < 9) fail(`expected >= 9 tools over stdio, got ${tools.length}`);
const missingSchema = tools.filter((t) => !t.outputSchema).map((t) => t.name);
if (missingSchema.length) fail(`tools missing outputSchema: ${missingSchema.join(', ')}`);

const call = byId[3]?.result;
if (!call)
  fail(
    `get_team call returned no result${byId[3]?.error ? `: ${JSON.stringify(byId[3].error)}` : ''}`,
  );
if (call.isError) fail(`get_team returned isError: ${JSON.stringify(call.content)}`);
const team = call.structuredContent?.team;
if (team?.code !== 'MEX')
  fail(`get_team("mexico") resolved ${JSON.stringify(team)} — expected code "MEX"`);

console.log(
  `✓ stdio smoke: ${init.serverInfo.name}@${init.serverInfo.version} · ${tools.length} tools, all with outputSchema · get_team("mexico") → MEX (node ${process.version})`,
);
