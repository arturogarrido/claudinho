/**
 * The user's config file: the competition they chose and, optionally, the team
 * they pinned in it. ONE path rule and ONE read, here in core, so the CLI and
 * the MCP server read the same file the same way. Written only by
 * `claudinho follow` (the CLI); the MCP server reads it and writes none.
 *
 * Core reads no environment: the edges hand in theirs (`process.env`,
 * `process.platform`, `os.homedir()`), like `resolveCompetition`'s sources.
 *
 * A read never guesses. A file that is absent, a symbolic link, unreadable,
 * malformed, of another version or naming no competition this product can
 * resolve is NO saved choice, and the read says which of those it was, for
 * `follow` to print. A pin that is not exactly a team is dropped, and the
 * competition stays.
 */
import { join, posix, win32 } from 'node:path';
import { lookAtOwnFile } from './files';
import { BUNDLED_SLUG, competitionValue } from './supported';
import { TEAM_CODE_COLUMNS } from './trust/match';
import { isHumanLabel, humanLabel, MAX_LABEL_COLUMNS, opaqueId, TEAM_ID } from './trust/roles';

/**
 * A pinned team, as `follow --team` resolved it: the provider's id (every
 * club, and required for one: a pin is believed without an id on the bundled
 * competition alone, whose nations the bundle names by code), and its code and
 * name as labels.
 */
export interface Pin {
  readonly id?: string;
  readonly code: string;
  readonly name: string;
}

/** The config file, as believed. */
export interface UserConfig {
  readonly version: 1;
  /** An alias, a slug in the table or a raw slug, AS WRITTEN: the resolver maps it. */
  readonly competition: string;
  readonly team?: Pin;
}

/** Why there is no saved choice. */
export type NoConfigReason = 'absent' | 'symlink' | 'unreadable' | 'malformed' | 'version' | 'competition';

/** What one read of the config file found. */
export type UserConfigRead = { kind: 'read'; config: UserConfig } | { kind: 'none'; reason: NoConfigReason };

/** The bound on the config file, in bytes: a real one is under 200. */
export const MAX_CONFIG_BYTES = 4096;

/** The environment a path rule reads: only the variables named below. */
type PathEnv = Readonly<Record<string, string | undefined>>;

/** An environment variable, an empty one being absent. */
function present(env: PathEnv, name: string): string | undefined {
  const v = env[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * An `XDG_*` base directory, as the base-directory specification defines one:
 * an ABSOLUTE path (for the platform the rule is asked for); a relative value
 * is invalid and ignored, so the next rule decides. The hot path must never
 * resolve its config or its cache against whatever directory the editor that
 * runs it happens to be in.
 */
function xdgBase(env: PathEnv, name: string, platform: string): string | undefined {
  const v = present(env, name);
  return v !== undefined && (platform === 'win32' ? win32 : posix).isAbsolute(v) ? v : undefined;
}

/**
 * Where the config file lives: `$XDG_CONFIG_HOME/claudinho/config.json` when
 * that is set to an absolute path (on every platform: tests and smokes set it;
 * a relative value is invalid and ignored, see {@link xdgBase}); else on
 * Windows `%APPDATA%\claudinho\config.json` when `APPDATA` is set; else
 * `<home>/.config/claudinho/config.json`. An empty variable is absent.
 */
export function configPath(env: PathEnv, platform: string, home: string): string {
  const xdg = xdgBase(env, 'XDG_CONFIG_HOME', platform);
  if (xdg) return join(xdg, 'claudinho', 'config.json');
  const appData = platform === 'win32' ? present(env, 'APPDATA') : undefined;
  if (appData) return join(appData, 'claudinho', 'config.json');
  return join(home, '.config', 'claudinho', 'config.json');
}

/**
 * Where the CLI's cache lives, by the same rule: `$XDG_CACHE_HOME/claudinho`
 * when set to an absolute path (a relative value is invalid and ignored, see
 * {@link xdgBase}); else on Windows `%LOCALAPPDATA%\claudinho` when set; else
 * `<home>/.cache/claudinho`. (A Windows install that used `~/.cache` moves
 * once: it is a cache, refilled by one cold refresh, and the throttle note
 * lives beside the snapshot, so it moves with it.)
 */
export function cacheDirFor(env: PathEnv, platform: string, home: string): string {
  const xdg = xdgBase(env, 'XDG_CACHE_HOME', platform);
  if (xdg) return join(xdg, 'claudinho');
  const local = platform === 'win32' ? present(env, 'LOCALAPPDATA') : undefined;
  if (local) return join(local, 'claudinho');
  return join(home, '.cache', 'claudinho');
}

const NONE = (reason: NoConfigReason): UserConfigRead => ({ kind: 'none', reason });

/**
 * A pinned team, believed only as `{ id?, code, name }`: `id`, when the key is
 * there, matching the team-id grammar exactly (`espn:359`, as `sealTeam` keeps
 * one); `code` and `name` human labels as typed (refused, never repaired: a
 * control or invisible character, an emoji, a tail past the bound), the code
 * upper-cased first, as `teamCode` cases a feed's (so a hand-written `mex` is
 * the `MEX` the hot path and the commands both compare by). The bounds
 * are a TEAM's, the same two constants `sealTeam` applies (`code` at most
 * `TEAM_CODE_COLUMNS`, `name` at most `MAX_LABEL_COLUMNS`), because the writer
 * (`follow --team`) copies a resolved team's labels as they are: any tighter,
 * and a club `next` resolves would be written and then read back as no pin.
 * An id-less pin is the bundled competition's alone (`bundled`): its nations
 * carry no id, while every club a feed resolves has one, so off it a pin
 * without an id is not a team `follow` wrote. Anything else is no pin.
 */
function believedPin(raw: unknown, bundled: boolean): Pin | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const t = raw as Record<string, unknown>;
  // Cased before it is bounded, as `teamCode` does (casing can grow a string).
  const upper = typeof t.code === 'string' ? t.code.toUpperCase() : t.code;
  if (!isHumanLabel(upper, TEAM_CODE_COLUMNS) || !isHumanLabel(t.name, MAX_LABEL_COLUMNS)) return undefined;
  const id = Object.hasOwn(t, 'id') ? opaqueId(t.id, TEAM_ID) : undefined;
  if (Object.hasOwn(t, 'id') && id === undefined) return undefined;
  if (id === undefined && !bundled) return undefined;
  const code = humanLabel(upper, TEAM_CODE_COLUMNS);
  const name = humanLabel(t.name, MAX_LABEL_COLUMNS);
  return id !== undefined ? { id, code, name } : { code, name };
}

/**
 * Read the config file at `path`, once: through the one bounded reader, NOT
 * following a symbolic link (`lookAtOwnFile`: a link is `symlink`, whatever it
 * points at), bounded at {@link MAX_CONFIG_BYTES} (a directory, a device, a
 * file past the bound or one without permission is `unreadable`), never
 * waiting. Then parsed: bytes that are not JSON, or a root that is not an
 * object, are `malformed`; a `version` that is not 1 (or none) is `version`; a
 * `competition` that is no alias, no slug in the table and no well-formed raw
 * slug (the resolver's grammar) is `competition`. The `team` is believed only
 * as a team (see {@link believedPin}: without an id only when the competition
 * resolves to the bundled one, an alias through the table); otherwise it is
 * dropped and the competition kept. Never throws.
 */
export function readUserConfig(path: string): UserConfigRead {
  const file = lookAtOwnFile(path, MAX_CONFIG_BYTES);
  if (file.kind === 'absent') return NONE('absent');
  if (file.kind === 'symlink') return NONE('symlink');
  if (file.kind !== 'read') return NONE('unreadable');
  let parsed: unknown;
  try {
    // A byte-order mark a Windows editor may have written is not the file.
    parsed = JSON.parse(file.bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return NONE('malformed');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NONE('malformed');
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1) return NONE('version');
  const competition = root.competition;
  // The resolver's grammar, asked of the value as written (an alias stays an alias).
  if (typeof competition !== 'string' || competitionValue(competition) === undefined) return NONE('competition');
  const team = Object.hasOwn(root, 'team') ? believedPin(root.team, savedSlug(competition) === BUNDLED_SLUG) : undefined;
  const config: UserConfig = team ? { version: 1, competition, team } : { version: 1, competition };
  return { kind: 'read', config };
}

/**
 * The slug a saved competition value names (`competitionValue`: an alias maps
 * through the table, a slug is itself, a raw slug is itself), or undefined for
 * a value the resolver's grammar refuses.
 */
export function savedSlug(value: string): string | undefined {
  const named = competitionValue(value);
  return named === undefined ? undefined : 'row' in named ? named.row.slug : named.raw;
}

/**
 * The saved pin that applies to a request for `selected` (the slug the edge
 * resolved, undefined when nothing or a refused value was): the file's team
 * when the file's competition IS that competition (an alias and its slug are
 * one), whatever chose it: the flag, the environment or the file itself. A
 * pin belongs to its competition, not to the source that chose it; another
 * competition does not apply it (a club's id is the same in every
 * competition, so a pin never carries over by accident). The ONE rule both
 * edges ask.
 */
export function pinUnder(selected: string | undefined, config: UserConfig | undefined): Pin | undefined {
  if (selected === undefined || !config?.team) return undefined;
  return savedSlug(config.competition) === selected ? config.team : undefined;
}
