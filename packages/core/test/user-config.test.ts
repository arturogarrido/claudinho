/**
 * The user's config file (0.11 · 2.5b, D1 and D2): ONE path rule and ONE
 * no-follow bounded read in core (`userConfig.ts`), on top of the bounded
 * single-descriptor readers that move from the CLI into core (`files.ts`), so
 * the CLI and the MCP server read the same file the same way and nothing reads
 * it by path. The file holds the chosen competition and the pinned team,
 * written only by `claudinho follow`. A read says why there is none, for
 * `follow` to print; it never guesses.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cacheDirFor, configPath, lookAtSmallFile, readSmallFile, readUserConfig, resolveCompetition } from '../src';

const tmp = mkdtempSync(join(tmpdir(), 'claudinho-config-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const write = (name: string, text: string) => {
  const p = join(tmp, name);
  writeFileSync(p, text);
  return p;
};
const valid = { version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } };

describe('the path', () => {
  it('XDG wins on every platform; else %APPDATA% on Windows; else ~/.config', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/x/cfg', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(join('/x/cfg', 'claudinho', 'config.json'));
    expect(configPath({ XDG_CONFIG_HOME: '/x/cfg' }, 'darwin', '/Users/a')).toBe(join('/x/cfg', 'claudinho', 'config.json'));
    expect(configPath({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'claudinho', 'config.json'));
    expect(configPath({}, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a', '.config', 'claudinho', 'config.json'));
    expect(configPath({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'claudinho', 'config.json'));
    // An empty variable is absent.
    expect(configPath({ XDG_CONFIG_HOME: '' }, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'claudinho', 'config.json'));
    // A relative XDG value is invalid (the base-directory spec) and ignored, on both rules: the hot path must not
    // resolve a config against the editor's working directory.
    expect(configPath({ XDG_CONFIG_HOME: 'cfg' }, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'claudinho', 'config.json'));
    expect(configPath({ XDG_CONFIG_HOME: './cfg' }, 'darwin', '/Users/a')).toBe(join('/Users/a', '.config', 'claudinho', 'config.json'));
    expect(cacheDirFor({ XDG_CACHE_HOME: 'cache' }, 'linux', '/home/a')).toBe(join('/home/a', '.cache', 'claudinho'));
    // A relative APPDATA or LOCALAPPDATA is ignored the same way.
    expect(configPath({ APPDATA: 'Roaming' }, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a', '.config', 'claudinho', 'config.json'));
    expect(cacheDirFor({ LOCALAPPDATA: 'Local' }, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a', '.cache', 'claudinho'));
    // APPDATA is Windows' alone: set on another platform it is not read.
    expect(configPath({ APPDATA: 'C:\\x' }, 'darwin', '/Users/a')).toBe(join('/Users/a', '.config', 'claudinho', 'config.json'));
    expect(configPath({ APPDATA: 'C:\\x' }, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'claudinho', 'config.json'));
  });

  it('the cache directory gains the same Windows leg: %LOCALAPPDATA% when set and XDG_CACHE_HOME is not', () => {
    expect(cacheDirFor({ XDG_CACHE_HOME: '/x/cache', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a')).toBe(join('/x/cache', 'claudinho'));
    expect(cacheDirFor({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a\\AppData\\Local', 'claudinho'));
    expect(cacheDirFor({}, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a', '.cache', 'claudinho'));
    expect(cacheDirFor({ LOCALAPPDATA: 'C:\\x' }, 'darwin', '/Users/a')).toBe(join('/Users/a', '.cache', 'claudinho'));
    expect(cacheDirFor({}, 'linux', '/home/a')).toBe(join('/home/a', '.cache', 'claudinho'));
  });
});

describe('the read', () => {
  it('a valid file: the competition and the pin', () => {
    const r = readUserConfig(write('valid.json', JSON.stringify(valid)));
    expect(r).toEqual({ kind: 'read', config: valid });
  });

  it('a pin\'s labels are bounded as a TEAM\'s labels are (the writer copies a resolved team): a 60-column name survives the round trip, a 101-column one does not', () => {
    const name60 = 'Club Deportivo Social y Cultural de la Universidad Nacional'; // 59 characters
    expect(name60.length).toBeGreaterThan(40);
    const r = readUserConfig(write('longname.json', JSON.stringify({ version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: name60 } })));
    expect(r).toEqual({ kind: 'read', config: { version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: name60 } } });
    const over = readUserConfig(write('overname.json', JSON.stringify({ version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: 'x'.repeat(101) } })));
    expect(over).toEqual({ kind: 'read', config: { version: 1, competition: 'eng.1' } });
  });

  it('a pin\'s code is a team code: upper-cased as the feed\'s are (a hand-written lower-case code would match the commands and never the hot path)', () => {
    const r = readUserConfig(write('lower.json', JSON.stringify({ version: 1, competition: 'fifa.world', team: { code: 'mex', name: 'Mexico' } })));
    expect(r).toEqual({ kind: 'read', config: { version: 1, competition: 'fifa.world', team: { code: 'MEX', name: 'Mexico' } } });
  });

  it('a byte-order mark is not the file; a version written as a string is not 1; a file of exactly the bound reads, one byte more does not', () => {
    const bom = readUserConfig(write('bom.json', `\uFEFF${JSON.stringify({ version: 1, competition: 'eng.1' })}`));
    expect(bom).toEqual({ kind: 'read', config: { version: 1, competition: 'eng.1' } });
    expect(readUserConfig(write('strv.json', JSON.stringify({ version: '1', competition: 'eng.1' })))).toEqual({ kind: 'none', reason: 'version' });
    const exact = JSON.stringify({ version: 1, competition: 'eng.1', pad: 'x'.repeat(4096 - 60) }).padEnd(4096, ' ');
    expect(exact.length).toBe(4096);
    expect(readUserConfig(write('exact.json', exact))).toEqual({ kind: 'read', config: { version: 1, competition: 'eng.1' } });
    expect(readUserConfig(write('over.json', `${exact} `))).toEqual({ kind: 'none', reason: 'unreadable' });
  });

  it('a pin is believed only as { id?, code, name } with the identifier grammar and human labels; else dropped, the competition kept', () => {
    const noId = readUserConfig(write('noid.json', JSON.stringify({ version: 1, competition: 'fifa.world', team: { code: 'MEX', name: 'Mexico' } })));
    expect(noId).toEqual({ kind: 'read', config: { version: 1, competition: 'fifa.world', team: { code: 'MEX', name: 'Mexico' } } });
    for (const team of [{ id: 'not an id', code: 'ARS', name: 'Arsenal' }, { code: 'ARS' }, { code: 'A\u0000RS', name: 'Arsenal' }, 'Arsenal', 7, { id: 'espn:359', code: 'x'.repeat(9), name: 'Arsenal' }]) {
      const r = readUserConfig(write('badpin.json', JSON.stringify({ version: 1, competition: 'eng.1', team })));
      expect(r, JSON.stringify(team)).toEqual({ kind: 'read', config: { version: 1, competition: 'eng.1' } });
    }
  });

  it('an id-less pin is believed for the bundled competition alone (its nations carry no id); off it a pin needs the id, else it is dropped', () => {
    const wc = readUserConfig(write('wc-noid.json', JSON.stringify({ version: 1, competition: 'world-cup', team: { code: 'MEX', name: 'Mexico' } })));
    expect(wc).toEqual({ kind: 'read', config: { version: 1, competition: 'world-cup', team: { code: 'MEX', name: 'Mexico' } } });
    const lib = readUserConfig(write('lib-noid.json', JSON.stringify({ version: 1, competition: 'conmebol.libertadores', team: { code: 'CAR', name: 'Carabobo' } })));
    expect(lib).toEqual({ kind: 'read', config: { version: 1, competition: 'conmebol.libertadores' } });
    const alias = readUserConfig(write('pl-noid.json', JSON.stringify({ version: 1, competition: 'premier-league', team: { code: 'ARS', name: 'Arsenal' } })));
    expect(alias).toEqual({ kind: 'read', config: { version: 1, competition: 'premier-league' } });
    // On the bundle an id KEY that is not an id is still no pin (never read as id-less).
    const badId = readUserConfig(write('wc-badid.json', JSON.stringify({ version: 1, competition: 'world-cup', team: { id: 'not an id', code: 'MEX', name: 'Mexico' } })));
    expect(badId).toEqual({ kind: 'read', config: { version: 1, competition: 'world-cup' } });
    const withId = readUserConfig(write('lib-id.json', JSON.stringify({ version: 1, competition: 'libertadores', team: { id: 'espn:7001', code: 'CAR', name: 'Carabobo' } })));
    expect(withId).toEqual({ kind: 'read', config: { version: 1, competition: 'libertadores', team: { id: 'espn:7001', code: 'CAR', name: 'Carabobo' } } });
  });

  it('absent → none (absent); malformed, a non-object root, a version that is not 1, a bad competition → none with the reason', () => {
    expect(readUserConfig(join(tmp, 'missing.json'))).toEqual({ kind: 'none', reason: 'absent' });
    expect(readUserConfig(write('malformed.json', '{not json'))).toEqual({ kind: 'none', reason: 'malformed' });
    expect(readUserConfig(write('array.json', '[1]'))).toEqual({ kind: 'none', reason: 'malformed' });
    expect(readUserConfig(write('v2.json', JSON.stringify({ ...valid, version: 2 })))).toEqual({ kind: 'none', reason: 'version' });
    expect(readUserConfig(write('nov.json', JSON.stringify({ competition: 'eng.1' })))).toEqual({ kind: 'none', reason: 'version' });
    expect(readUserConfig(write('badcomp.json', JSON.stringify({ version: 1, competition: 'ENG.1' })))).toEqual({ kind: 'none', reason: 'competition' });
    expect(readUserConfig(write('nocomp.json', JSON.stringify({ version: 1 })))).toEqual({ kind: 'none', reason: 'competition' });
    // An alias is accepted as written, a raw dotted slug too.
    expect(readUserConfig(write('alias.json', JSON.stringify({ version: 1, competition: 'premier-league' })))).toEqual({ kind: 'read', config: { version: 1, competition: 'premier-league' } });
    expect(readUserConfig(write('raw.json', JSON.stringify({ version: 1, competition: 'fifa.friendly' })))).toEqual({ kind: 'read', config: { version: 1, competition: 'fifa.friendly' } });
  });

  it('a symlink to a valid file reads as none (symlink): the read never follows', () => {
    const target = write('target.json', JSON.stringify(valid));
    const link = join(tmp, 'link.json');
    symlinkSync(target, link);
    expect(readUserConfig(link)).toEqual({ kind: 'none', reason: 'symlink' });
  });

  it('a directory, and a file past the bound, read as none (unreadable)', () => {
    const dir = join(tmp, 'dir.json');
    mkdirSync(dir);
    expect(readUserConfig(dir)).toEqual({ kind: 'none', reason: 'unreadable' });
    const big = write('big.json', JSON.stringify({ ...valid, pad: 'x'.repeat(5000) }));
    expect(readUserConfig(big)).toEqual({ kind: 'none', reason: 'unreadable' });
  });

  it('an unreadable file (no permission) reads as none (unreadable)', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const p = write('noperm.json', JSON.stringify(valid));
    chmodSync(p, 0o000);
    try {
      expect(readUserConfig(p)).toEqual({ kind: 'none', reason: 'unreadable' });
    } finally {
      chmodSync(p, 0o600);
    }
  });
});

describe('the readers live in core', () => {
  it('lookAtSmallFile and readSmallFile are core exports with the four answers', () => {
    const p = write('small.txt', 'hello');
    expect(lookAtSmallFile(p, 16)).toMatchObject({ kind: 'read' });
    expect(readSmallFile(p, 16)?.toString('utf8')).toBe('hello');
    expect(lookAtSmallFile(join(tmp, 'nope'), 16)).toEqual({ kind: 'absent' });
    expect(lookAtSmallFile(p, 2)).toEqual({ kind: 'unreadable' });
  });
});

describe('the resolver with the saved choice', () => {
  it('the saved choice is the third source; with nothing, none (no World Cup default)', () => {
    expect(resolveCompetition(undefined, undefined, 'premier-league')).toMatchObject({ kind: 'selected', slug: 'eng.1', chosenBy: 'saved' });
    expect(resolveCompetition(undefined, 'laliga', 'premier-league')).toMatchObject({ slug: 'esp.1', chosenBy: 'env' });
    expect(resolveCompetition('serie-a', 'laliga', 'premier-league')).toMatchObject({ slug: 'ita.1', chosenBy: 'flag' });
    expect(resolveCompetition()).toEqual({ kind: 'none' });
    expect(resolveCompetition('', '', '')).toEqual({ kind: 'none' });
    // A saved value the file reader would not have passed is still refused here, never a guess.
    expect(resolveCompetition(undefined, undefined, 'foo').kind).toBe('refused');
  });
});
