import { SUPPORTED } from '@claudinho/core';

/** The competitions the framing names; the rest are counted from the supported table. */
const NAMED = ['the World Cup', 'the Premier League', 'LALIGA', 'the Champions League'];

/**
 * The CLI's one line (0.11 · 2.7): the cli package's first sentence, said by
 * `--help` and `star`. The count is interpolated from the supported table
 * (`SUPPORTED.length` less the competitions named), so a new row changes it with
 * no edit here; the static copies of the same sentence (the listings, the
 * READMEs) are pinned to the table by core's public-copy test.
 */
export const TAGLINE = `Live football scores, fixtures and standings in your terminal and your Claude Code and Cursor CLI statusline, for the competition you follow: ${NAMED.join(', ')} and ${SUPPORTED.length - NAMED.length} more.`;
