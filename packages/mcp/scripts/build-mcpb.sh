#!/usr/bin/env bash
# Build the Claudinho Claude Desktop Extension (.mcpb).
#
# Produces packages/mcp/claudinho.mcpb — a one-click install bundle for Claude
# Desktop (Settings → Extensions → Install Extension…).
#
# The bundle contains: manifest.json, the built server (server/index.js, which
# already inlines @claudinho/core), and a production node_modules holding the
# only two external runtime deps (@modelcontextprotocol/sdk + zod). The MCPB
# spec requires Node extensions to bundle all dependencies.
set -euo pipefail

MCP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
OUT="$MCP_DIR/claudinho.mcpb"

# Pin the packer for reproducible bundles (bump deliberately). The canonical,
# lockfile-pinned release artifacts are the npm packages; this .mcpb is a
# convenience bundle whose runtime deps track @claudinho/mcp's declared ranges.
MCPB_VERSION="2.1.2"

echo "→ building server bundle"
( cd "$MCP_DIR" && ./node_modules/.bin/tsup >/dev/null 2>&1 )

echo "→ staging extension at $STAGE"
mkdir -p "$STAGE/server"
cp "$MCP_DIR/dist/index.js" "$STAGE/server/index.js"
cp "$MCP_DIR/mcpb/manifest.json" "$STAGE/manifest.json"
cp "$MCP_DIR/README.md" "$STAGE/README.md" 2>/dev/null || true
cp "$MCP_DIR/LICENSE" "$STAGE/LICENSE" 2>/dev/null || true

# Minimal package.json so `npm install` pulls only the runtime deps the bundle
# needs (core is inlined; sdk + zod are external in the tsup config).
SDK_VER="$(node -e "console.log(require('$MCP_DIR/package.json').dependencies['@modelcontextprotocol/sdk'])")"
ZOD_VER="$(node -e "console.log(require('$MCP_DIR/package.json').dependencies['zod'])")"
EXT_VER="$(node -e "console.log(require('$MCP_DIR/mcpb/manifest.json').version)")"
cat > "$STAGE/package.json" <<EOF
{
  "name": "claudinho-mcpb",
  "version": "$EXT_VER",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "$SDK_VER",
    "zod": "$ZOD_VER"
  }
}
EOF

echo "→ installing production deps into the bundle"
( cd "$STAGE" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 )

echo "→ packing with mcpb@$MCPB_VERSION"
( cd "$STAGE" && npx -y "@anthropic-ai/mcpb@$MCPB_VERSION" pack . "$OUT" )

rm -rf "$STAGE"
echo "✓ built $OUT"
ls -la "$OUT"
