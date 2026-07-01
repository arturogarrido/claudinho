#!/usr/bin/env node
/**
 * Build the Smithery / `.mcpb` bundle for the Claudinho MCP server.
 *
 * Smithery (and Claude Desktop) install a LOCAL stdio server from a `.mcpb`
 * bundle: a zip of `manifest.json` + the built server + its runtime deps. Our
 * tsup bundle inlines `@claudinho/core` but keeps `@modelcontextprotocol/sdk`
 * and `zod` external, so this stages those into a fresh, portable `node_modules`,
 * smoke-tests the server, then packs. Output goes to `dist/` (gitignored).
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
  copyFileSync(join(pkgDir, 'mcpb', 'manifest.json'), join(stage, 'manifest.json'));
  copyFileSync(distEntry, join(stage, 'server', 'index.js'));
  // Minimal package.json so `npm install` stages ONLY the server's runtime deps
  // (kept external by tsup) into a portable node_modules the bundle can ship.
  const stagePkg = {
    name: 'claudinho-mcpb',
    version: pkg.version,
    private: true,
    dependencies: pkg.dependencies,
  };
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagePkg, null, 2)}\n`);
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stage,
    stdio: 'inherit',
  });

  // Smoke test: the staged server must start and list its tools before we ship it
  // (proves the external deps resolve inside the bundle layout). stdin EOF exits it.
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
  if (!out.includes('"serverInfo"') || !out.includes('get_today')) {
    throw new Error('bundle smoke test failed — server did not initialize / list its tools');
  }

  const outFile = join(pkgDir, 'dist', `claudinho-${pkg.version}.mcpb`);
  execFileSync('npx', ['--yes', '@anthropic-ai/mcpb', 'pack', stage, outFile], { stdio: 'inherit' });
  console.log(`\n✅ built + smoke-tested → ${outFile}`);
  console.log(`   publish: smithery mcp publish ${outFile} -n arturogarrido/claudinho`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
