/**
 * The MCP line's options carry the request's clock as a REQUIRED field: a
 * site that builds them without one does not compile. Type-checked by
 * `pnpm typecheck` (this folder is in the package's tsconfig), never run by
 * vitest: an `@ts-expect-error` whose error disappears is itself the error.
 */
import type { Match } from '@claudinho/core';
import { matchLine, matchList, matchRows } from '../src/format';

declare const m: Match;

export function refused(): void {
  // @ts-expect-error `now` is required: a line without the request's clock would count from the wall clock
  matchLine(m, { flavor: 'off' });
  // @ts-expect-error the options are required: the list's lines take the request's clock
  matchRows([m], 'none');
  // @ts-expect-error the options are required: the list's lines take the request's clock
  matchList([m], 'none');
}
