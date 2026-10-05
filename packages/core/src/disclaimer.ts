/**
 * The one non-affiliation sentence (0.11, ledger D5 option B). A leaf: every
 * runtime surface imports it (the share card footer, the CLI's help footer and
 * its English localized footer, the MCP server's footer), and the static copies
 * that cannot import it (the listing JSON files, the public Markdown) are pinned
 * to it by `test/disclaimer.test.ts`. A listing host is added by
 * `disclaimerLine(host)`, the only composition: never a second spelling.
 */

/** Not affiliated with FIFA, any confederation, league or club, or Anthropic. */
export const DISCLAIMER = 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.';

/** The fan line every footer pairs with the disclaimer. */
export const FAN_PROJECT = 'Independent fan project';

/**
 * The disclaimer, with `, nor with <host>` before its final period when a host
 * is given (a listing's own host: "Smithery", "Cursor").
 */
export function disclaimerLine(host?: string): string {
  if (!host) return DISCLAIMER;
  return `${DISCLAIMER.slice(0, -1)}, nor with ${host}.`;
}
