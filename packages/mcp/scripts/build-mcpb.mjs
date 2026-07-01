#!/usr/bin/env node
/**
 * Build the Smithery / `.mcpb` bundle for the Claudinho MCP server.
 *
 * Smithery (and Claude Desktop) install a LOCAL stdio server from a `.mcpb`
 * bundle: a zip of `manifest.json` + the built server + its runtime deps. Our
 * tsup bundle inlines `@claudinho/core` but keeps `@modelcontextprotocol/sdk`
 * and `zod` external, so this stages those into a fresh, portable `node_modules`,
 * smoke-tests the server, then zips it (a `.mcpb` is a zip). Injects the server's
 * live tool `inputSchema`s into the bundled manifest — Smithery's publish requires
 * them, while `mcpb pack`'s validator rejects them, so we zip directly. Output goes
 * to `dist/` (gitignored).
 *
 *   pnpm -F @claudinho/mcp build:mcpb
 *   smithery mcp publish packages/mcp/dist/claudinho-<version>.mcpb -n arturogarrido/claudinho
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const distEntry = join(pkgDir, 'dist', 'index.js');

if (!existsSync(distEntry)) {
  console.error('dist/index.js not found — run `pnpm -F @claudinho/mcp build` first.');
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'claudinho-mcpb-'));
try {
  mkdirSync(join(stage, 'server'), { recursive: true });
  copyFileSync(distEntry, join(stage, 'server', 'index.js'));
  // Minimal package.json so `npm install` stages ONLY the server's runtime deps
  // (kept external by tsup) into a portable node_modules the bundle can ship.
  const stagePkg = {
    name: 'claudinho-mcpb',
    version: pkg.version,
    private: true,
    type: 'module', // the tsup server bundle is ESM
    dependencies: pkg.dependencies,
  };
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagePkg, null, 2)}\n`);
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stage,
    stdio: 'inherit',
  });

  // Handshake: smoke-test the staged server AND capture its live tool definitions.
  // Smithery's publish validation requires an inputSchema OBJECT on every manifest
  // tool (name+description alone fails with "expected object, received undefined"),
  // so we inject the server's real inputSchemas below. stdin EOF exits the server.
  const handshake =
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'build-mcpb', version: '1' } } })}\n` +
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`;
  let out = '';
  try {
    out = execFileSync('node', [join(stage, 'server', 'index.js')], {
      input: handshake,
      cwd: stage,
      encoding: 'utf8',
      timeout: 20_000,
    });
  } catch (e) {
    out = String(e.stdout ?? ''); // a timeout/non-zero exit may still have written the replies
  }
  let serverTools;
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (msg.id === 2 && msg.result?.tools) serverTools = msg.result.tools;
  }
  if (!out.includes('"serverInfo"') || !serverTools?.length) {
    throw new Error('bundle smoke test failed — server did not initialize / list its tools');
  }

  // Write the manifest with FULL tool defs: the curated description from
  // mcpb/manifest.json (kept as-is for the guard test) + the live inputSchema that
  // Smithery requires. The source manifest is never mutated.
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'mcpb', 'manifest.json'), 'utf8'));
  const declaredByName = Object.fromEntries((manifest.tools ?? []).map((t) => [t.name, t]));
  manifest.tools = serverTools.map((t) => ({
    name: t.name,
    ...(t.title ? { title: t.title } : {}),
    description: declaredByName[t.name]?.description ?? t.description,
    inputSchema: t.inputSchema,
    // Carry the server's real annotations (readOnlyHint/openWorldHint) into the
    // manifest — Smithery scores the bundled manifest, so without these it reports
    // "Annotations 0/8" even though every tool declares them.
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const outFile = join(pkgDir, 'dist', `claudinho-${pkg.version}.mcpb`);
  // A .mcpb IS a zip. We zip the staged bundle directly rather than `mcpb pack`
  // because mcpb's manifest validator REJECTS `inputSchema` in tools ("Unrecognized
  // key"), while Smithery's publish REQUIRES it — the two schemas conflict, and
  // Smithery is the target here. The smoke test above is our correctness gate.
  rmSync(outFile, { force: true });
  execFileSync(
    'zip',
    ['-r', '-q', outFile, 'manifest.json', 'server', 'node_modules', 'package.json'],
    { cwd: stage, stdio: 'inherit' },
  );
  console.log(`\n✅ built + smoke-tested → ${outFile}`);
  console.log(`   publish: smithery mcp publish ${outFile} -n arturogarrido/claudinho`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
