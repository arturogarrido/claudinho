/**
 * Builds the Claudinho MCP server: tools, resources, and prompts wired to the
 * pure handlers in tools.ts. The same server object works over stdio in Claude
 * Code, Cursor, Codex, and any other MCP client.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { types as utilTypes } from 'node:util';
// zod 4's bundled zod-3 entry point, on purpose: the SDK converts a zod-3 schema
// with zod-to-json-schema and a zod-4 schema with zod 4's own emitter, and the
// two differ (input objects lose `additionalProperties: false`, `$ref`s are
// inlined, records gain `propertyNames`, `$schema` moves) — 710 changed lines of
// tools/list, i.e. an MCP-affecting release. Through `zod/v3` every advertised
// schema stays byte-identical. Moving the declarations to zod 4 classic is a
// deliberate, MCP-affecting migration, not a dependency bump.
import { z } from 'zod/v3';
import {
  allFixtures,
  asFlavorLevel,
  BUNDLE_COMPETITION,
  competitionLabel,
  fixturesByDate,
  groups,
  humanLabel,
  isHumanLabel,
  isValidDate,
  isValidTimeZone,
  TABLE_KEY_ARG,
} from '@claudinho/core';
import { DISCLAIMER, matchList } from './format';
import {
  noCompetitionText,
  resolveAdapter,
  selectionOf,
  standingsResourceText,
  toolGetBracket,
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetStandings,
  toolGetTeam,
  toolGetToday,
  toolListCompetitions,
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
    : `\nVoice: when relaying scores, narrate with lively, regionally-appropriate football-commentary energy in the user's language. Each match line may end with a short exclamation ("— ¡GOOOOL!"): use it as a tone cue. Keep every fact exact; never invent details and never impersonate or name a real commentator.`;

export const INSTRUCTIONS = `Claudinho serves live scores, fixtures, and standings for one football competition per request, chosen by the tool call's competition argument (an alias such as premier-league, or an ESPN slug such as eng.1), else the server's CLAUDINHO_COMPETITION, else the user's saved choice (set with claudinho follow <alias>). With none of the three, every competition-answering tool answers noCompetition with a sentence saying what to do: pass competition, or ask the user to run claudinho follow <alias>. list_competitions lists the supported competitions, their aliases and what each offers, offline. Every tool's text but get_team's, get_share_snippet's and list_competitions' starts with the competition it is for, and its structured data carries it as competition (get_share_snippet's card names it in its title; list_competitions says it last, as Current, and in data.current; get_team is the World Cup's roster). An unknown competition is a tool error that lists the aliases.
get_next_fixture and get_share_snippet take a team as a name or a code: a club's ("Arsenal", "ARS") in a club competition, a nation's ("Mexico", "MEX") in the World Cup. get_next_fixture with no team answers for the server's CLAUDINHO_TEAM, else for the team the user pinned (claudinho follow <alias> --team <name>) when the request is for that team's competition. Several teams matching one name come back as candidates; ask which one, never pick. get_market_signal takes a nation's 3-letter code (market signals are read for the World Cup alone). get_team resolves a nation's name to its code in the World Cup roster, offline; it knows no clubs.
Use get_live during matches, get_today for a day's schedule, get_next_fixture for a specific team, get_standings for standings tables, and get_bracket for the knockout tree (a league season with no knockout tie answers inapplicable).
Off the World Cup, get_next_fixture and get_match search from yesterday to 14 days ahead: an empty answer carrying horizon or window is about that span, not about the team or the match. betweenEditions means the competition's edition has ended and the next has not started.
Never infer that a fixture is happening now from get_next_fixture or a team's next card: relay the returned competition, the fixture, its date and its state, and call it in play only when the returned state says so; an empty answer keeps its horizon or verdict, never an invented fixture.
get_standings with no group returns every table. One table is selected by its key, which every table's title shows in parentheses unless it is a plain group letter: A to L for lettered groups, A1 for a numbered group, A-B for group B of league A, LEAGUE for a league's single table.
Use get_market_signal for read-only prediction-market signals (a match, a team's current-or-next fixture, or a date). Market data is informational only: relay the percentages factually and never frame it as betting or trading advice.
Use get_share_snippet to produce a ready-to-paste match card (for a match, a team's next fixture, a date, or live matches), and hand the user the returned snippet text verbatim.${VOICE}
${DISCLAIMER}`;

// Tightened, reusable input schemas (exported for tests). Rejecting bad input
// at the schema boundary gives clients accurate hints and avoids silent
// fallback to defaults for invalid values.
export const dateArg = z
  .string()
  .refine(isValidDate, 'must be a real calendar date in YYYY-MM-DD form');
/** A table key: a group letter, or a key such as `A1`, `A-B`, `LEAGUE` (core `TABLE_KEY_ARG`). */
export const groupArg = z
  .string()
  .regex(TABLE_KEY_ARG, 'a table key: a group letter (A), or a key such as A1, A-B or LEAGUE');
export const teamArg = z.string().regex(/^[A-Za-z]{3}$/, 'a 3-letter team code, e.g. MEX');
/**
 * A team as a reader names it: a code or a name ("ARS", "Arsenal", "O&M"),
 * bounded like a human label (1 to 40 characters, no control or invisible
 * character: core's `isHumanLabel`). The team-taking tools that resolve a club take it; the market
 * tool keeps `teamArg` (markets cover the World Cup's nations only).
 */
export const clubArg = z
  .string()
  .min(1)
  .max(40)
  .refine(
    // Core's human-label grammar, asked as a question: a value it would have
    // to repair (an invisible, control or emoji character) is refused.
    (v) => isHumanLabel(v, 40),
    'a team name or code (1 to 40 characters, no invisible or control characters), e.g. Arsenal or ARS',
  );
export const flavorArg = z.enum(['off', 'subtle', 'full']);
/**
 * A time zone is an IDENTIFIER (a text role, like a team code), not prose: an
 * IANA zone the runtime can resolve, checked at the edge, so the SDK refuses
 * anything else before a handler runs or a request is made. The share
 * formatter prints the zone verbatim beside every time; a 40,000-character
 * "zone" pushed a date card past the text cut, which dropped the row the
 * provider served and kept the attribution beside a bundled one. The set the
 * runtime knows bounds its length (IANA's longest names are 30 characters).
 */
export const tzArg = z
  .string()
  .refine((v) => isValidTimeZone(v), 'an IANA time zone, e.g. America/Mexico_City');

/**
 * The competition a call is for: an alias or a slug, resolved by the server's
 * edge (`selectionOf`), which refuses anything else with the aliases. A plain
 * string here, so the refusal is the edge's (it names the aliases), not a
 * schema message.
 */
const competitionArg = z
  .string()
  .describe(
    "The competition: an alias such as premier-league, or an ESPN slug such as eng.1 (list_competitions lists the aliases). Without it: the server's CLAUDINHO_COMPETITION, else the user's saved choice (claudinho follow); with none, the answer is noCompetition",
  );

/** The reader's language, optional: every competition-answering tool and `list_competitions` take it. */
const langArg = z
  .string()
  .optional()
  .describe(
    "Locale for dates, list titles, match status and stage words, the empty and outage sentences, provider attribution, and commentary: en, es, pt, fr (the market copy, a few notes and the disclaimer stay English; other locales fall back to en)",
  );

// Shared optional args every competition-answering tool accepts (all but get_team).
const commonArgs = {
  competition: competitionArg.optional(),
  tz: tzArg.optional().describe('IANA timezone for kickoff times, e.g. America/Mexico_City'),
  lang: langArg,
  flavor: flavorArg.optional().describe('Commentary flair: off, subtle, full (default: full)'),
};

// ---- Output schemas (structured tool output) --------------------------------
// Declared per tool so clients know each tool's return shape (and the .mcpb
// manifest carries it). Deliberately PERMISSIVE: `.passthrough()` on objects so
// no field is stripped and forward-compatible additions never break validation;
// every branch-specific key is optional. Domain types live in @claudinho/core as
// TS interfaces, so these are hand-mirrored (kept loose on purpose).
// `id` is the provider's stable team id (`espn:359`), present on a team read
// from a live feed. DECLARED, not left to passthrough: an agent that follows a
// club needs a handle it can rely on being part of the contract.
const teamRef = z
  .object({ code: z.string(), name: z.string(), flag: z.string(), id: z.string() })
  .partial()
  .passthrough();
const scorePair = z.object({ home: z.number(), away: z.number() }).partial().passthrough();
const matchOut = z
  .object({
    id: z.string(),
    stage: z.string().optional(),
    // The provider's own words for a phase the stage grammar does not know
    // (`stage: "OTHER"`), present only then. Declared: an agent is told the key exists.
    stageLabel: z.string().optional(),
    group: z.string().nullable().optional(),
    kickoff: z.string().optional(),
    venue: z.string().optional(),
    home: teamRef.optional(),
    away: teamRef.optional(),
    score: scorePair.nullable().optional(),
    shootout: scorePair.optional(),
    status: z.string().optional(),
    minute: z.number().nullable().optional(),
    winnerCode: z.string().optional(),
  })
  .passthrough();
const anyObj = z.object({}).passthrough();
/** What a capability is for a competition (core `Capability`). */
const capabilityOut = z.enum(['offered', 'not-offered-yet', 'not-applicable']);
/** The selection as one structured key (core `selectionExtras`). */
const competitionKeyOut = z.object({
  slug: z.string(),
  alias: z.string().optional(),
  name: z.string(),
  chosenBy: z.enum(['flag', 'env', 'saved']),
  experimental: z.literal(true).optional(),
});
/**
 * The competition an answer is for, on every competition-answering tool's
 * data (core `selectionExtras`); the text says it in its first line.
 */
const selectionOut = {
  competition: competitionKeyOut
    .passthrough()
    .nullable()
    .optional()
    .describe(
      'The competition this answer is for: its ESPN slug, its alias, its name, where the choice came from (flag: the competition argument; env: the server\'s CLAUDINHO_COMPETITION; saved: the user\'s saved choice, claudinho follow), and experimental for a slug the supported table does not hold; null with noCompetition when nothing is chosen',
    ),
};
const src = z.string().nullable();
const responseMeta = {
  responseTruncated: z.boolean().optional(),
  responseTruncation: z.string().optional(),
};
/**
 * The first replacing verdict (core `selectionVerdict`): nothing is chosen, so
 * nothing was read. Declared on EVERY competition-answering tool (the
 * standings tool too, which declares no other replacing verdict).
 */
const noCompetitionOut = {
  noCompetition: z
    .literal(true)
    .optional()
    .describe(
      'Present (true) when no competition is chosen (no competition argument, no server CLAUDINHO_COMPETITION, no saved choice): nothing was read, competition is null, and the text says what to do (pass competition, or the user runs claudinho follow <alias>)',
    ),
};

/**
 * The verdicts a result may state about itself (core `verdictExtras`), declared
 * on every tool that can state one. Present only when stated: `unsupported:
 * true` tells an agent reading `structuredContent` that an empty answer means
 * "this does not exist for the selected competition", not "nothing was found".
 * Undeclared, the SDK would strip it and the text would be the only place the
 * verdict lived.
 */
const verdictOut = {
  ...noCompetitionOut,
  unsupported: z
    .literal(true)
    .optional()
    .describe(
      'Present (true) when this is not available for this competition yet; an empty result then means "unsupported", not "none found"',
    ),
  inapplicable: z
    .literal(true)
    .optional()
    .describe('Present (true) when this competition has no such thing at all (a league season with no knockout tie has no knockout tree)'),
  unknownTeam: z
    .literal(true)
    .optional()
    .describe(
      "Present (true) when the roster the competition has holds no team by that name: the bundled nations on the World Cup; the table read whole and the next 14 days' fixtures elsewhere (a claim about that evidence, not the whole competition: a club out in a qualifying round is in no table). Never stated when the table or the span could not be read whole",
    ),
  rosterEvidence: z
    .enum(['table', 'bundle'])
    .optional()
    .describe(
      "With unknownTeam: the evidence it rests on, the competition's table and span (table) or the World Cup's bundled nations (bundle)",
    ),
  rosterIncomplete: z
    .literal(true)
    .optional()
    .describe(
      "Present (true) when the competition's roster could not be read whole and the name could not be resolved without it (no match, or only by a code or a partial name); not an outage: ask with the club's full name",
    ),
  betweenEditions: z
    .object({ ended: z.string(), label: z.string().optional() })
    .optional()
    .describe(
      "Present when the competition is between editions: the edition named by label ended on ended (the provider's calendar day, YYYY-MM-DD, the season end it states), and nothing in the read is scheduled or in play",
    ),
};

/**
 * The verdict of an all-tables standings read from which the provider's
 * answer is missing a table (core `verdictExtras`). Declared for the same
 * reason as `unsupported`: undeclared, the SDK would strip it.
 */
const incompleteOut = {
  incomplete: z
    .literal(true)
    .optional()
    .describe(
      'Present (true) when the provider sent a table that could not be read: the tables returned are not the whole competition',
    ),
};

/**
 * The verdict of a read whose provider answer was not whole (core
 * `verdictExtras`): the result holds what was read, and the window held more.
 * `omitted` is the count of provider records left out, present only when it is
 * known. Declared for the same reason as `unsupported`: undeclared, the SDK
 * would strip it.
 */
const partialOut = {
  partial: z
    .object({ omitted: z.number().int().positive().optional() })
    .optional()
    .describe(
      'Present when the provider sent records that could not be used: what is returned is what was read, and may not be the whole answer (absence is not elimination). omitted is how many provider records were left out, when known; they may have lain outside what was asked for, so the count is a bound, not a loss',
    ),
};

/** The ids a read's window held: a plain field of the answer, not a verdict. */
const servedOut = z
  .array(z.string())
  .describe(
    "The shown fixtures whose record the provider's window held; a shown fixture not among them is the bundled schedule's row, its live state unconfirmed",
  );
const todayOut = {
  date: z.string(),
  degraded: z.boolean(),
  source: src,
  served: servedOut.optional(),
  // `count` is the TRUE total and `matches` may be a bounded view of it, so the
  // payload states whether it was cut rather than leaving a consumer to infer
  // it from two numbers.
  count: z.number(),
  truncated: z.boolean(),
  matches: z.array(matchOut),
  marketSignals: z.record(anyObj).optional(),
  marketComplete: z
    .boolean()
    .optional()
    .describe('False when optional market enrichment did not check every relevant fixture'),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
const liveOut = {
  degraded: z.boolean(),
  source: src,
  count: z.number(),
  truncated: z.boolean(),
  matches: z.array(matchOut),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
/** The span a whole read searched, in the provider's calendar days (plain fields, not verdicts). */
const horizonOut = z
  .object({ days: z.number().int().positive() })
  .describe('Off the World Cup: a whole read of this many provider days ahead held no fixture for the team');
const windowOut = z
  .object({ from: z.string(), to: z.string() })
  .describe('Off the World Cup: a whole read of these provider days (YYYY-MM-DD, inclusive) did not hold the match');
const matchDetailOut = {
  match: matchOut.nullable(),
  degraded: z.boolean().optional(),
  source: src.optional(),
  served: servedOut.optional(),
  marketSignal: anyObj.nullable().optional(),
  marketComplete: z
    .boolean()
    .optional()
    .describe('False when optional market enrichment did not check this fixture'),
  window: windowOut.optional(),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
const standingsOut = {
  degraded: z.boolean(),
  source: src,
  tables: z.union([anyObj, z.array(anyObj), z.null()]),
  ...noCompetitionOut,
  ...incompleteOut,
  ...selectionOut,
  ...responseMeta,
};
const bracketOut = {
  view: anyObj.nullable(),
  degraded: z.boolean().optional(),
  standingsDegraded: z.boolean().optional(),
  source: src.optional(),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
const nextOut = {
  // The World Cup answers with the nation's code; a club competition with the
  // club the query resolved to (its provider id, code and name), or the query
  // as asked when none was resolved.
  team: z.union([z.string(), teamRef]),
  fixture: matchOut.nullable(),
  degraded: z.boolean(),
  source: src,
  candidates: z
    .array(teamRef)
    .optional()
    .describe('Two or more teams matched the name: no fixture is picked; ask which one'),
  horizon: horizonOut.optional(),
  season: anyObj.optional(),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
const marketOut = {
  matchId: z.string().nullable().optional(),
  team: z.string().optional(),
  date: z.string().optional(),
  degraded: z.boolean().optional(),
  informationalOnly: z.boolean(),
  signal: anyObj.nullable().optional(),
  signals: z.array(anyObj).optional(),
  // Present on the list-shaped branches: the TRUE total and whether the array
  // beside it was capped, so a consumer reading only `structuredContent` can
  // tell a complete list from a truncated one.
  count: z.number().optional(),
  truncated: z.boolean().optional(),
  complete: z
    .boolean()
    .optional()
    .describe('False when the market provider did not complete every relevant read'),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
const shareOut = {
  kind: z.string(),
  target: z.string().optional(),
  snippet: z.string().optional(), // absent on the bracket "unknown stage" error branch
  source: src.optional(),
  served: servedOut.optional(),
  informationalOnly: z.boolean().optional(),
  degraded: z.boolean().optional(),
  style: z.string().optional(),
  // A next card's team: the club resolved (provider id, code, name) when one
  // was, the query (a nation's code on the World Cup) otherwise.
  team: z.union([z.string(), teamRef]).optional(),
  candidates: z
    .array(teamRef)
    .optional()
    .describe('A next card for a name two or more teams match: them, and no fixture is picked'),
  group: z.string().optional(),
  stage: z.string().optional(),
  tables: z.union([anyObj, z.array(anyObj), z.null()]).optional(),
  view: anyObj.nullable().optional(),
  matches: z.array(matchOut).optional(),
  marketSignals: z.record(anyObj).optional(),
  marketComplete: z
    .boolean()
    .optional()
    .describe('False when optional market enrichment did not check every relevant fixture'),
  count: z.number().optional(),
  truncated: z.boolean().optional(),
  horizon: horizonOut.optional(),
  window: windowOut.optional(),
  ...verdictOut,
  ...partialOut,
  ...selectionOut,
  ...responseMeta,
};
const teamInfo = z
  .object({ code: z.string(), name: z.string(), flag: z.string(), group: z.string() })
  .partial()
  .passthrough();
const teamOut = {
  query: z.string(),
  team: teamInfo.nullable(),
  matches: z.array(teamInfo),
  count: z.number(),
  ...responseMeta,
};
/** The supported table (core `listCompetitions`): ours, whole, so strict. */
const listCompetitionsOut = {
  competitions: z.array(
    z
      .object({
        slug: z.string(),
        alias: z.string(),
        name: z.string(),
        teams: z.enum(['nation', 'club']),
        kind: z.enum(['league', 'cup']),
        capabilities: z
          .object({
            scores: capabilityOut,
            next: capabilityOut,
            standings: capabilityOut,
            bracket: capabilityOut,
            markets: capabilityOut,
          })
          .strict(),
      })
      .strict(),
  ),
  current: competitionKeyOut
    .strict()
    .nullable()
    .describe('The competition this request is for (its competition argument, else the server\'s, else the user\'s saved choice), as every other tool\'s data carries it; null when nothing is chosen'),
  ...responseMeta,
};

/**
 * The per-tool output shapes, keyed by tool name (exported so a test can
 * validate that every handler's `data` — healthy AND degraded — parses against
 * the schema the tool advertises). Keep in lockstep with the registerTool calls.
 */
export const OUTPUT_SCHEMAS = {
  get_today: todayOut,
  get_live: liveOut,
  get_match: matchDetailOut,
  get_standings: standingsOut,
  get_bracket: bracketOut,
  get_next_fixture: nextOut,
  get_market_signal: marketOut,
  get_share_snippet: shareOut,
  get_team: teamOut,
  list_competitions: listCompetitionsOut,
} as const;

/**
 * Ceiling on one tool response, in characters of serialized JSON.
 *
 * The record COUNT is bounded (40) and every field is bounded, but neither
 * bounds their product: 40 maximal fixtures whose `events` arrays are full can
 * still serialize to megabytes, and this is model context on every call. The
 * hook already learned this — bounding each field and the record count is not
 * the same as bounding the sum. A real response is a few KB.
 *
 * Applied at the ONE place every tool's payload leaves the server, rather than
 * per handler, so a tool added later cannot forget it.
 */
export const MAX_RESPONSE_CHARS = 128_000;

const RESPONSE_TRUNCATION =
  'Optional response detail was truncated to stay within the MCP context limit.';

/**
 * Shrink a payload until it fits, whatever SHAPE it has.
 *
 * The first version special-cased a top-level `matches` array, which meant the
 * bracket, standings and share shapes walked straight past it — a 300 KB share
 * snippet was returned in full. Bounding the shape you thought of is not
 * bounding the payload.
 *
 * Generic, in increasing order of damage: drop optional `events` detail,
 * truncate long strings, then shorten arrays. Every tool schema declares the
 * response metadata added after a successful shrink. If none of those
 * schema-preserving passes fits, `toContent` returns a bounded explicit error
 * without `structuredContent` instead of fabricating a schema-invalid shape.
 */
const SHRINK_FAILED = Symbol('shrink-failed');

/**
 * Work budget applied before JSON.stringify or the recursive shrink passes.
 * Real responses are far below these ceilings; they allow the largest tested
 * fixture/event response while refusing shapes whose inspection alone could
 * monopolize the long-running MCP server.
 */
const MAX_INSPECTION_DEPTH = 64;
const MAX_INSPECTION_ARRAY_LENGTH = 4_096;
const MAX_INSPECTION_KEYS_PER_OBJECT = 1_024;
const MAX_INSPECTION_ENTRIES = 65_536;
const MAX_INSPECTION_CONTAINERS = 16_384;
const MAX_INSPECTION_CHARS = 2_000_000;

type InspectionFrame =
  | { readonly value: unknown; readonly depth: number; readonly exit?: false }
  | { readonly value: object; readonly depth: number; readonly exit: true };

/**
 * Prove that measuring and shrinking this value have bounded work.
 *
 * This is iterative so a 50,000-level object cannot overflow the stack. It
 * reads data descriptors rather than property values, so accessors are refused
 * without executing attacker-controlled getters. The ancestor set detects
 * cycles but permits shared subtrees, matching JSON.stringify's behavior while
 * charging each serialized occurrence to the aggregate budgets.
 */
function withinInspectionBudget(root: unknown): boolean {
  const stack: InspectionFrame[] = [{ value: root, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let containers = 0;
  let entries = 0;
  let chars = 0;

  try {
    while (stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.exit) {
        ancestors.delete(frame.value);
        continue;
      }
      const { value, depth } = frame;
      if (typeof value === 'string') {
        chars += value.length;
        if (chars > MAX_INSPECTION_CHARS) return false;
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if (depth >= MAX_INSPECTION_DEPTH || ancestors.has(value)) return false;
      // A Proxy can change its descriptors between preflight and stringify, or
      // make `ownKeys` allocate an unbounded list before a loop can stop.
      if (utilTypes.isProxy(value)) return false;
      containers += 1;
      if (containers > MAX_INSPECTION_CONTAINERS) return false;

      const proto = Object.getPrototypeOf(value);
      const expectedProto = Array.isArray(value) ? Array.prototype : Object.prototype;
      if (proto !== expectedProto && proto !== null) return false;
      if (
        Object.getOwnPropertyDescriptor(value, 'toJSON') ||
        (proto && Object.getOwnPropertyDescriptor(proto, 'toJSON'))
      ) {
        return false;
      }

      ancestors.add(value);
      stack.push({ value, depth, exit: true });

      if (Array.isArray(value)) {
        if (value.length > MAX_INSPECTION_ARRAY_LENGTH) return false;
        entries += value.length;
        if (entries > MAX_INSPECTION_ENTRIES) return false;
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor) continue; // JSON serializes a hole as null.
          if (!('value' in descriptor)) return false;
          stack.push({ value: descriptor.value, depth: depth + 1 });
        }
        continue;
      }

      let keys = 0;
      for (const key in value as Record<string, unknown>) {
        keys += 1;
        if (keys > MAX_INSPECTION_KEYS_PER_OBJECT) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        if (!('value' in descriptor)) return false;
        entries += 1;
        chars += key.length;
        if (entries > MAX_INSPECTION_ENTRIES || chars > MAX_INSPECTION_CHARS) return false;
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
    return true;
  } catch {
    // Proxies and exotic objects can throw from reflection. Tool data is plain
    // structured data; an uninspectable shape takes the explicit error path.
    return false;
  }
}

function shrink(
  value: unknown,
  pass: 1 | 2 | 3,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown | typeof SHRINK_FAILED {
  // A schema-preserving shrink may shorten strings/arrays or remove the
  // optional match `events` detail. It may not replace a required nested value
  // with null merely to fit. Deep/cyclic shapes therefore take the explicit
  // bounded-error path in `toContent`.
  if (depth >= 64) return SHRINK_FAILED;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return SHRINK_FAILED;
    ancestors.add(value);
    const items = pass === 3 ? value.slice(0, 8) : value;
    const out: unknown[] = [];
    for (const item of items) {
      const shrunk = shrink(item, pass, depth + 1, ancestors);
      if (shrunk === SHRINK_FAILED) return SHRINK_FAILED;
      out.push(shrunk);
    }
    ancestors.delete(value);
    return out;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return SHRINK_FAILED;
    ancestors.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'events') continue; // always the first thing to go
      const shrunk = shrink(v, pass, depth + 1, ancestors);
      if (shrunk === SHRINK_FAILED) return SHRINK_FAILED;
      out[k] = shrunk;
    }
    ancestors.delete(value);
    return out;
  }
  if (typeof value === 'string') {
    if (pass >= 2 && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  }
  return value;
}

/**
 * Serialized size, or Infinity if it cannot even be measured.
 *
 * `JSON.stringify` THROWS `RangeError: Invalid string length` past V8's maximum
 * string length, and on a cycle. Measuring was the one step assumed safe, so a
 * big enough payload did not return over-budget — it crashed the tool call.
 * Unmeasurable is treated as "too big", which routes it to the harsher pass.
 */
function size(v: unknown): number {
  try {
    return JSON.stringify(v ?? null)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function boundResponse(data: unknown): unknown {
  if (!withinInspectionBudget(data)) return null;
  if (size(data) <= MAX_RESPONSE_CHARS) return data;
  // Every declared tool output is an object. Spreading a top-level array into
  // numeric object keys would fit the byte cap by violating that contract.
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  for (const pass of [1, 2, 3] as const) {
    const candidate = shrink(data, pass);
    if (
      candidate === SHRINK_FAILED ||
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const marked = {
      ...(candidate as Record<string, unknown>),
      responseTruncated: true,
      responseTruncation: RESPONSE_TRUNCATION,
    };
    if (size(marked) <= MAX_RESPONSE_CHARS) return marked;
  }
  // `null` is an internal sentinel: `toContent` turns it into a small explicit
  // MCP error and omits structuredContent, so no invalid output-schema skeleton
  // is ever handed to the SDK.
  return null;
}

/** Ceiling on the prose block, which is model context too and was never bounded. */
const MAX_TEXT_CHARS = 32_000;

/**
 * Above this, the JSON text block is dropped rather than duplicating
 * `structuredContent`. Comfortably larger than any real response.
 */
const DUAL_EMIT_LIMIT = 16_000;

const TRUNCATED = '\n(truncated)';

/**
 * The prose block: a tool's text, then `tail` (a sentence about the response
 * itself), within MAX_TEXT_CHARS. A text that fits is returned whole. One that
 * does not is cut at a length, the cut is said, and what is lost is the end of
 * the BODY, never the footer (`ToolResult.footer`: the attribution and the
 * non-affiliation disclaimer, which every user-facing surface carries and a cut
 * from the end used to take first). What qualifies the body is printed before
 * it for the same reason (a verdict, a partial table, a degraded line, a market
 * notice, a list's truncation: the rule on `ToolResult.footer`), so nothing but
 * the footer follows the body.
 */
function boundText(r: { text: string; footer?: string; cutFooter?: string }, tail: string): string {
  if (r.text.length + tail.length <= MAX_TEXT_CHARS) return r.text + tail;
  const room = Math.max(0, MAX_TEXT_CHARS - tail.length - TRUNCATED.length);
  // A footer that is not the end of the text is not one. What the cut keeps of
  // it is `cutFooter` when the result names one (a day on a read that was not
  // whole keeps the disclaimer, not the attribution: `ToolResult.footer`), and
  // what would not fit is not kept.
  const real = !!r.footer && r.text.endsWith(r.footer);
  const kept = real ? (r.cutFooter ?? r.footer ?? '') : '';
  const footer = kept.length <= room ? kept : '';
  // The prefix ends at the body's end: a kept footer SHORTER than the original
  // (a cut footer) must not let the slice run into the footer it replaced.
  const bodyEnd = real ? r.text.length - (r.footer ?? '').length : r.text.length;
  let cut = Math.min(room - footer.length, bodyEnd);
  // Never half a character: a cut that lands inside a surrogate pair gives one unit back.
  const last = r.text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${r.text.slice(0, cut)}${TRUNCATED}${footer}${tail}`;
}

/**
 * A tool's result as the MCP tool response. The footer is optional HERE only:
 * a tool handler must state one (`ToolResult`); a result built by hand (a
 * test) need not, and is then cut from the end like any text.
 *
 * We emit the payload BOTH as `structuredContent` (schema-validated, for clients
 * that support it) AND as a JSON block inside `content` — deliberately, not by
 * oversight. MCP's backwards-compat guidance is that a tool with an outputSchema
 * SHOULD still serialize the same data into a text block, so clients that don't
 * read `structuredContent` (older/simple ones) still get the structured data.
 * The redundancy costs a few tokens for agents that read both; dropping the text
 * block would silently blind those older clients to everything but the prose.
 */
export function toContent(r: Omit<ToolResult, 'footer'> & { footer?: string }) {
  const data = boundResponse(r.data);
  const dataTruncated =
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).responseTruncated === true;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error =
      'Response data exceeded the MCP context limit and could not be reduced without violating its output schema.';
    return {
      content: [{ type: 'text' as const, text: boundText(r, `\n\n${error}`) }],
      isError: true,
    };
  }
  const text = boundText(r, dataTruncated ? `\n\n(${RESPONSE_TRUNCATION})` : '');
  // The JSON text block DUPLICATES `structuredContent`; that dual-emit is
  // deliberate, so clients too old to read structuredContent still get the data
  // (see the note above). But duplicating a large payload doubles the context
  // for a compatibility case, so past a threshold the block is dropped and the
  // prose carries it — modern clients read structuredContent regardless.
  const compact = JSON.stringify(data);
  const content = [{ type: 'text' as const, text }];
  if (compact.length <= DUAL_EMIT_LIMIT) {
    content.push({
      type: 'text' as const,
      text: '```json\n' + JSON.stringify(data, null, 2) + '\n```',
    });
  }
  return { content, structuredContent: data as Record<string, unknown> };
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
      description:
        "All fixtures for a date (default: today), with live score and minute overlaid on any match in play. Optional prediction-market enrichment carries marketComplete; false means the read was incomplete, not that no signal exists. Off the World Cup, betweenEditions means the competition's edition ended before that date. partial means the provider sent records that could not be used: on the World Cup a fixture may then show from the bundled schedule without its live state (the text counts them, and names no provider when none shown was served), and where no bundled schedule was merged, an empty day means no fixture could be read for it, not that none is scheduled. Use this for a whole day's card; for only in-play matches use get_live, for one team's match use get_next_fixture, for a single match's detail use get_match. Kickoffs render in tz; lang localizes the title, dates, status and stage words, the empty and outage sentences, attribution, and commentary (en/es/pt/fr); flavor sets commentary tone.",
      inputSchema: {
        date: dateArg.optional().describe('Date as YYYY-MM-DD (default: today)'),
        ...commonArgs,
      },
      // Read-only; reaches an external data provider for the live overlay.
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: todayOut,
    },
    async (args) => toContent(await toolGetToday(args)),
  );

  server.registerTool(
    'get_live',
    {
      title: 'Live matches',
      description:
        'Only matches in play right now, each with current score and minute; an empty list means nothing is in play only when the read was whole (neither partial nor degraded says otherwise). Off the World Cup, betweenEditions means the competition\'s edition has ended and the next has not started. partial means the provider sent records that could not be used: an empty list then means no match in play could be read, not that none is. Use during matches for in-play state; for a full day\'s schedule including upcoming and finished, use get_today. tz/lang/flavor affect formatting only.',
      inputSchema: { ...commonArgs },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: liveOut,
    },
    async (args) => toContent(await toolGetLive(args)),
  );

  server.registerTool(
    'get_match',
    {
      title: 'Match detail',
      description:
        "One match by its id, with live score/minute overlaid when it's in play. Off the World Cup the id is looked for from yesterday to 14 days ahead: window names the provider days searched when it was not there (not found in that span, not \"no such match\"), and degraded with a match means its state could not be refreshed. Optional prediction-market enrichment carries marketComplete; false means the read was incomplete, not that no signal exists. Get the id from get_today or get_live; to find a team's match without an id, use get_next_fixture. tz/lang/flavor affect formatting.",
      inputSchema: { id: z.string().describe('Match id'), ...commonArgs },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: matchDetailOut,
    },
    async (args) => toContent(await toolGetMatch(args)),
  );

  server.registerTool(
    'get_standings',
    {
      title: 'Standings',
      description:
        'Live cumulative standings: omit group for every table, or pass one table\'s key: a group letter (A–L in the World Cup), A1 for a numbered group, A-B for group B of league A, LEAGUE for a league\'s single table. Each table that is not a lettered group carries a label (the provider\'s name) and its title shows the key in parentheses. Returns ranked rows (team, played, W/D/L, goal difference, points). incomplete:true means a table could not be read and the tables returned are not the whole competition; a table with partial is missing rows. Use get_today for fixtures/scores and get_next_fixture for one team. If unavailable, the World Cup returns its roster at zero; competitions without a compatible bundled roster return no tables. Both are flagged degraded.',
      inputSchema: {
        group: groupArg.optional().describe('Table key: a group letter (A), or A1, A-B, LEAGUE (omit for all)'),
        ...commonArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: standingsOut,
    },
    async (args) => toContent(await toolGetStandings(args)),
  );

  server.registerTool(
    'get_bracket',
    {
      title: 'Knockout bracket',
      description:
        'Knockout bracket from the Round of 32 through the final, with live scores overlaid. Group slots project from live standings once a group has started; winner slots need a confirmed FT result. Pass an optional stage (R32, R16, QF, SF, 3P, F) to filter one round. partial means the provider sent records that could not be used: the ties shown are the ones read, and may not be all of them. Falls back to structure-only when live data is unavailable. A league season with no knockout tie of its own (the Premier League, LaLiga) answers inapplicable: there is none to show; other club competitions answer unsupported (not offered yet).',
      inputSchema: {
        stage: z
          .enum(['R32', 'R16', 'QF', 'SF', '3P', 'F'])
          .optional()
          .describe('Knockout round to show (omit for the full bracket)'),
        ...commonArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: bracketOut,
    },
    async (args) => toContent(await toolGetBracket(args)),
  );

  server.registerTool(
    'get_next_fixture',
    {
      title: 'Next fixture for a team',
      description:
        "A team's next match. World Cup: a nation's code or name (MEX, Mexico); a confirmed knockout tie is read from the live overlay, group fixtures from the bundled schedule. A club competition: a club's name or code (Arsenal, ARS), resolved against the competition's roster; its earliest match not yet finished in the 14 days ahead (in play included), with team (the club resolved), candidates when several teams match (no fixture is picked), horizon when none falls in that span, unknownTeam when neither the competition's table (read whole) nor its fixtures over those 14 days hold such a team, rosterIncomplete when the roster could not be read whole and the name (a code or a partial name) could not be resolved without it: ask again with the club's full name. partial means the provider sent records that could not be used: the answer is what was read, and no fixture then does not mean the team is out. With no team: the server's CLAUDINHO_TEAM, else the team the user pinned (claudinho follow <alias> --team <name>) when the request is for that team's competition; a tool error when there is neither.",
      inputSchema: {
        team: clubArg
          .optional()
          .describe("A team name or code: a club (Arsenal, ARS) or a nation (Mexico, MEX). Omit for the server's CLAUDINHO_TEAM, else the team the user pinned"),
        ...commonArgs,
      },
      // Read-only; overlays live provider data for knockout pairings, so open-world.
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: nextOut,
    },
    async (args) => toContent(await toolGetNextFixture(args)),
  );

  server.registerTool(
    'get_market_signal',
    {
      title: 'Prediction-market signal',
      description:
        "Read-only prediction-market signals for a match (by id), a team's current-or-next fixture, or a date (default: today). Returns market-implied percentages with attribution; complete:false means the provider read was incomplete, not that no signal exists; partial says the same of the fixture read behind the answer (the provider sent fixture records that could not be used). Shown only before and during a match: finished matches have no market read. Informational only: relay the numbers factually; do not add betting, trading, or 'value' advice, and do not invent links.",
      inputSchema: {
        matchId: z.string().optional().describe('Match id (most specific)'),
        team: teamArg
          .optional()
          .describe(
            "3-letter team code, e.g. MEX; resolves to the team's in-play match when one is live, else their next fixture",
          ),
        date: dateArg
          .optional()
          .describe("Date as YYYY-MM-DD (default: today) for all that day's signals"),
        ...commonArgs,
      },
      // Read-only; reaches an external prediction-market data provider.
      annotations: { readOnlyHint: true, openWorldHint: true },
      outputSchema: marketOut,
    },
    async (args) => toContent(await toolGetMarketSignal(args)),
  );

  server.registerTool(
    'get_share_snippet',
    {
      title: 'Shareable match snippet',
      description:
        "A polished, copy-pasteable card (plain text) for a match (matchId), a team's next fixture (team), one standings table (group: a table key, e.g. \"A\", \"A1\", \"A-B\" or \"LEAGUE\"), the knockout bracket (bracket: true), a date (default: today), or live matches (live: true). Returns the ready-to-paste snippet plus structured data: hand the snippet text to the user verbatim. marketComplete:false is stated inside the card as an incomplete optional read; partial (on any match card, live and date included) is stated inside the card too: the provider sent records that could not be used. Off the World Cup a next card names the club resolved, and an empty card says the span searched (horizon, window) or that the competition is between editions. No links; it carries a non-affiliation disclaimer, and any market line stays informational only.",
      inputSchema: {
        matchId: z.string().optional().describe('Match id (most specific)'),
        team: clubArg
          .optional()
          .describe("A team name or code for that team's next fixture: a club (Arsenal) or a nation (MEX)"),
        group: groupArg.optional().describe('Table key for a standings card: a group letter (A), or A1, A-B, LEAGUE'),
        bracket: z.boolean().optional().describe('Knockout bracket card (use with optional knockoutStage)'),
        knockoutStage: z
          .enum(['R32', 'R16', 'QF', 'SF', '3P', 'F'])
          .optional()
          .describe('Filter the bracket card to one round'),
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
      outputSchema: shareOut,
    },
    async (args) => toContent(await toolGetShareSnippet(args)),
  );

  server.registerTool(
    'get_team',
    {
      title: 'Resolve a team',
      description:
        "The World Cup roster: resolve a nation name or 3-letter code to its FIFA code, flag, and group. Fuzzy and forgiving: accepts \"Mexico\", \"mex\", \"USA\", \"DR Congo\", \"Türkiye\"/\"Turkey\", \"Holland\", etc. Useful for the 3-letter code get_market_signal needs. It knows no clubs: get_next_fixture and get_share_snippet resolve a club's name themselves. Returns the single confident match (team), plus candidates (matches) when the query is ambiguous (e.g. \"south\" → South Africa, South Korea). Offline: reads the bundled roster, never the network.",
      inputSchema: {
        query: z.string().describe('Team name or 3-letter code, e.g. "Mexico", "MEX", "DR Congo"'),
      },
      // Read-only AND offline — resolves against the bundled roster, no provider call.
      annotations: { readOnlyHint: true, openWorldHint: false },
      outputSchema: teamOut,
    },
    async (args) => toContent(toolGetTeam(args)),
  );

  server.registerTool(
    'list_competitions',
    {
      title: 'Supported competitions',
      description:
        "The competitions Claudinho answers for, one per row: the alias every other tool's competition argument takes, the name, the teams (nation or club), the kind (league or cup), and what each surface is (scores, next, standings, bracket, markets: offered, not-offered-yet, or not-applicable), plus current: the competition this request is for. Offline: reads the supported table, never the network. Whether an edition is in season is not listed here; the reads say so (betweenEditions).",
      // `lang` localizes the Current line (the names are not localized) and a refusal.
      inputSchema: { competition: competitionArg.optional(), lang: langArg },
      // Read-only AND offline — the supported table ships with the server.
      annotations: { readOnlyHint: true, openWorldHint: false },
      outputSchema: listCompetitionsOut,
    },
    async (args) => toContent(toolListCompetitions(args)),
  );

  // ---- Resources ----
  // One standings table as readable text: standings://A
  server.registerResource(
    'standings',
    new ResourceTemplate('standings://{group}', { list: undefined }),
    {
      title: 'Standings table',
      description:
        "One live standings table, by its key: a group letter (standings://A), or A1, A-B, LEAGUE, for the server's competition, which its text names first. There is no all-tables form: use get_standings.",
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const group = String(variables.group ?? '');
      // Shares the get_standings path → live standings, fail-closed roster, and
      // the SAME provider attribution + disclaimer — and the SAME server-lifetime
      // adapter, so a retained provider throttle (audit A12) covers the resource
      // too instead of a fresh adapter per read fetching through it. The
      // selection is resolved first (a refused one builds no adapter), once,
      // for this read: the adapter is the one resolved for the same request.
      const request = {};
      const selection = selectionOf(request);
      // Nothing chosen: the verdict's sentence, and nothing read.
      const text =
        selection.kind === 'selected'
          ? await standingsResourceText(group, resolveAdapter(request), selection)
          : noCompetitionText(selection);
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
      description: 'Static fixture list for a UTC date (YYYY-MM-DD): the bundled World Cup schedule, whatever the server\'s competition, named first.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const date = String(variables.date ?? '');
      // The read's own clock, read once here: a resource carries none, and a
      // scheduled line's countdown is relative to the moment it is read.
      const now = new Date();
      // The bundled schedule is the World Cup's, whatever the server's
      // competition: its text names it first.
      const text = `${competitionLabel(BUNDLE_COMPETITION)}\n${matchList(fixturesByDate(date, undefined, 'UTC'), `No matches on ${date}.`, { now })}`;
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    },
  );

  // ---- Prompts ----
  server.registerPrompt(
    'tournament_today',
    {
      title: "Today's matches",
      description: "Summarize today's matches in the selected competition and what to watch.",
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: "Use the get_today and get_live tools to summarize today's football matches in the selected competition (the server's, or the one the competition argument names). Highlight any matches in play, then list the rest with kickoff times in my timezone.",
          },
        },
      ],
    }),
  );

  // The followed competition's prompt: the tools are called with no
  // competition argument (the server's, else the user's saved choice), so the
  // prompt never resolves a competition itself. The market read alone is the
  // World Cup's (market signals are read for the World Cup alone), and it is
  // asked of the fixture get_next_fixture returned, by its id: a team's code
  // selects the team's current match, which can differ from its next one.
  const myTeamArgs = {
    team: clubArg
      .optional()
      .describe(
        "A club's or a nation's code or name in the competition you follow, e.g. Arsenal, ARS, Mexico or MEX. Omit it for your team: the server's CLAUDINHO_TEAM when it is set, else the one pinned with claudinho follow --team",
      ),
  };
  const myTeam = server.registerPrompt(
    'my_team',
    {
      title: 'My team',
      description:
        "Focus on one team's next match in the competition you follow: its date and state, the team's standing in the table, and, on the World Cup, the prediction-market read.",
      argsSchema: myTeamArgs,
    },
    ({ team: asked }) => {
      // The bounded label, never the raw argument, goes into the prompt. No
      // team: the server's CLAUDINHO_TEAM, else the pinned one.
      const team = asked === undefined ? '' : humanLabel(asked, 40);
      const text = [
        team
          ? `Tell me about ${team}'s next match and ${team}'s current standing.`
          : "Tell me about my team's next match and its current standing.",
        "Call each tool for the competition I follow: pass no competition argument (the server's competition applies, else my saved choice).",
        'If a tool answers noCompetition, tell me to run claudinho follow <alias> and stop.',
        'If a tool answers an error naming the competitions, relay it and stop.',
        ...(team
          ? [
              `Call get_next_fixture with ${team} as team (a team's code or name).`,
              'If it answers unknownTeam, relay that answer as it is, then ask me which team and stop.',
            ]
          : [
              "Call get_next_fixture with no team: it answers for my team, the server's CLAUDINHO_TEAM when it is set, else the team I pinned for this competition with claudinho follow --team.",
              "It answers an error when no team was given, the server's CLAUDINHO_TEAM is unset and none is pinned for this competition, or when CLAUDINHO_TEAM holds nothing readable: then ask me which team and stop.",
              'If it answers unknownTeam, relay that answer as it is, then ask me which team and stop.',
            ]),
        "Always state the fixture's date and its state (scheduled, in play or finished), and call it in play only when the state says so: a next fixture is not a match happening now.",
        'If get_next_fixture answers no fixture, relay that answer as it is, with its horizon or its verdict when it carries one, and never invent a fixture.',
        'Name the competition the answer names.',
        `For the standing, call get_standings and read ${team ? `${team}'s` : "that team's"} row of its table (its group, or the league table).`,
        'When the competition has no table, or the answer says tables could not be read, say so.',
        "Only when the competition is the World Cup and get_next_fixture returned a fixture, also call get_market_signal with matchId set to that fixture's id (fixture.id in its data), never with the team's code, and relay what prediction markets say about that match.",
        'In any other competition, do not call get_market_signal and say nothing about markets.',
        'When you relay market percentages, treat them as informational context only: relay them factually, never as betting or trading advice.',
      ].join(' ');
      return { messages: [{ role: 'user', content: { type: 'text', text } }] };
    },
  );
  // "No team" arrives in three forms, and each is read as no team (the pinned
  // one): `arguments` left out of prompts/get (the protocol allows it when no
  // argument is required, and the SDK parses the arguments object as sent, so
  // a request with none would be refused: "Required"), an empty object, and
  // the argument left blank (a client may send a blank field as ""). A blank
  // team is the empty string or ordinary spaces only (U+0020): it is dropped
  // before `clubArg`, whose `min(1)` would refuse it. Anything else, a tab, a
  // no-break space or an invisible character included, goes to `clubArg` as
  // it is, so a 41-character or an invisible-character team is still refused.
  //
  // This replaces the schema the SDK built from `myTeamArgs`, and relies on
  // three SDK internals (1.31.0, `server/mcp.js` and `server/zod-compat.js`),
  // which a future SDK could break: prompts/list builds the arguments from the
  // schema's `shape`, read through `getObjectShape` (so the `shape` property
  // keeps the listing `[{ name: 'team', required: false, description }]`);
  // prompts/get keeps a schema that has a `shape` (`normalizeObjectSchema`)
  // and parses `request.params.arguments` with it through `safeParseAsync`
  // (so the preprocess runs before the object parse); and
  // `RegisteredPrompt.argsSchema` is a plain assignable field (the prompt's
  // `update({ argsSchema })` would rebuild it from a shape and drop this).
  const blankTeamIsNone = (v: unknown): unknown => {
    if (v === undefined || v === null) return {};
    if (typeof v !== 'object') return v;
    const { team, ...rest } = v as { team?: unknown };
    return typeof team === 'string' && /^ *$/.test(team) ? rest : v;
  };
  myTeam.argsSchema = Object.assign(z.preprocess(blankTeamIsNone, z.object(myTeamArgs)), { shape: myTeamArgs });

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
