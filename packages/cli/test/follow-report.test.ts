/**
 * What `follow` reports is what the NEXT command will do (0.11 · 2.5b,
 * review): a `--competition` flag decides this command alone, so after
 * `--competition laliga follow world-cup --team Spain` the headline and the
 * JSON's `competition` are the World Cup's (the saved choice, which the next
 * command without the flag follows), with the flag named as this command's
 * override; the environment, which outlives the command, is what the next
 * command follows when it is set.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdFollow } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-follow-report-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});
const text = () => writes.join('');
const ctxOf = (over: { json?: boolean; competition?: string } = {}) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...over });
  return { cfg, t: makeT(cfg.lang) };
};

describe('after a write under a flag', () => {
  it('the headline and the JSON say what the next command follows: the saved choice, the flag named as this command\'s', async () => {
    await cmdFollow('world-cup', {}, ctxOf({ competition: 'laliga', json: true }));
    const j = JSON.parse(text());
    expect(j.saved).toEqual({ version: 1, competition: 'fifa.world' });
    expect(j.competition).toMatchObject({ slug: 'fifa.world', chosenBy: 'saved' });
    // `override` is the reported competition's source (rule 39): the saved choice here, so none; the
    // flag that ran this command is named in `sources`.
    expect(j.override).toBeUndefined();
    expect(j.sources).toEqual({ flag: 'esp.1' });
    writes = [];
    await cmdFollow('world-cup', {}, ctxOf({ competition: 'laliga' }));
    expect(text()).toMatch(/Following: World Cup/);
    expect(text()).toMatch(/--competition/);
    // And the next command, without the flag, follows the World Cup.
    expect(resolveConfig({})).toMatchObject({ competition: 'fifa.world', selection: { chosenBy: 'saved' } });
  });

  it('with the environment also set, the next command follows the environment: the headline says so', async () => {
    process.env.CLAUDINHO_COMPETITION = 'premier-league';
    await cmdFollow('world-cup', {}, ctxOf({ competition: 'laliga', json: true }));
    const j = JSON.parse(text());
    expect(j.saved).toEqual({ version: 1, competition: 'fifa.world' });
    expect(j.competition).toMatchObject({ slug: 'eng.1', chosenBy: 'env' });
    expect(j.override).toBe('env');
    expect(resolveConfig({})).toMatchObject({ competition: 'eng.1', selection: { chosenBy: 'env' } });
  });
});

describe('one list of facts in every form: what the edge saw', () => {
  it('the JSON says which sources this command ran under (`sources`), in every form, beside what the next command follows', async () => {
    await cmdFollow('world-cup', {}, ctxOf());
    // Alone, under a flag AND the environment: both named; the flag is this command's selection.
    process.env.CLAUDINHO_COMPETITION = 'premier-league';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'laliga', json: true }));
    let j = JSON.parse(text());
    expect(j.sources).toEqual({ flag: 'esp.1', env: 'eng.1' });
    expect(j.competition).toMatchObject({ slug: 'esp.1', chosenBy: 'flag' });
    expect(j.override).toBe('flag');
    // A write under both: the next command follows the environment; the flag that ran this command is still named.
    writes = [];
    await cmdFollow('serie-a', {}, ctxOf({ competition: 'laliga', json: true }));
    j = JSON.parse(text());
    expect(j.sources).toEqual({ flag: 'esp.1', env: 'eng.1' });
    expect(j.competition).toMatchObject({ slug: 'eng.1', chosenBy: 'env' });
    expect(j.override).toBe('env');
    expect(j.saved).toEqual({ version: 1, competition: 'ita.1' });
    delete process.env.CLAUDINHO_COMPETITION;
    // The saved choice alone: no sources, no override.
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    j = JSON.parse(text());
    expect(j.sources).toBeUndefined();
    expect(j.override).toBeUndefined();
  });

  it('a REFUSED flag on a write is reported, in the text and the JSON, with its source; the refused value is bounded', async () => {
    const junk = `${'x'.repeat(300)}!`;
    await cmdFollow('world-cup', {}, ctxOf({ competition: junk, json: true }));
    let j = JSON.parse(text());
    expect(j.saved).toEqual({ version: 1, competition: 'fifa.world' });
    // The flag and the environment each sit in exactly one of `sources` (resolved) and `refused` (as given, bounded), under their own name.
    expect(Object.keys(j.refused)).toEqual(['flag']);
    expect(j.refused.flag.length).toBeLessThanOrEqual(40);
    expect(j.sources).toBeUndefined();
    // The write is done and the environment is not set: the next command follows the saved choice
    // (rule 39: `competition` is null only when the environment is refused too).
    expect(j.competition).toMatchObject({ slug: 'fifa.world', chosenBy: 'saved' });
    writes = [];
    await cmdFollow('world-cup', {}, ctxOf({ competition: 'foo' }));
    expect(text()).toMatch(/foo/);
    expect(text()).toMatch(/--competition/);
    // A refused environment: its own sentence says the environment is set.
    process.env.CLAUDINHO_COMPETITION = 'bar';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_COMPETITION/);
    expect(text()).toMatch(/bar/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    j = JSON.parse(text());
    expect(j.refused).toEqual({ env: 'bar' });
    expect(j.sources).toBeUndefined();
    delete process.env.CLAUDINHO_COMPETITION;
  });

  it('no redundant `Saved choice:` line when the competition in effect is the saved one', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    for (const over of [{}, { competition: 'premier-league' }] as Array<{ competition?: string }>) {
      writes = [];
      await cmdFollow(undefined, {}, ctxOf(over));
      expect(text()).toMatch(/Following: Premier League/);
      expect(text()).not.toMatch(/Saved choice:/);
    }
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).not.toMatch(/Saved choice:/);
    delete process.env.CLAUDINHO_COMPETITION;
  });
});

describe('the team override', () => {
  it('with CLAUDINHO_TEAM set, the saved pin is reported as saved, not as the team in effect, and the override is named in the text and the JSON', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    process.env.CLAUDINHO_TEAM = 'Mexico';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    const lines = text().split('\n').map((l) => l.trim()).filter(Boolean);
    const following = lines.findIndex((l) => /^Following: World Cup/.test(l));
    expect(lines[following + 1]).not.toMatch(/^Team: Spain/);
    expect(text()).toMatch(/Saved team: Spain/);
    expect(text()).toMatch(/CLAUDINHO_TEAM/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    const j = JSON.parse(text());
    expect(j.saved.team).toEqual({ code: 'ESP', name: 'Spain' });
    expect(j.sources).toMatchObject({ team: 'Mexico' });
    // The same right after saving Spain while the override is set.
    writes = [];
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    expect(text()).toMatch(/Saved team: Spain/);
    expect(text()).toMatch(/CLAUDINHO_TEAM/);
    delete process.env.CLAUDINHO_TEAM;
    // Without it, the pin is the team in effect.
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/Team: Spain/);
  });
});

describe('the environment has three states: unset, set, refused', () => {
  it('a flag that ran with a REFUSED environment: the sentence says the next command refuses it, the refusal is printed, and the JSON carries it under `refused.env`', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    process.env.CLAUDINHO_COMPETITION = 'foo';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/Following: World Cup/);
    expect(text()).toMatch(/foo/);
    expect(text()).not.toMatch(/CLAUDINHO_COMPETITION decides|then the saved choice/);
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is refused/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup', json: true }));
    let j = JSON.parse(text());
    expect(j.competition).toMatchObject({ slug: 'fifa.world', chosenBy: 'flag' });
    expect(j.override).toBe('flag');
    expect(j.sources).toEqual({ flag: 'fifa.world' });
    expect(j.refused).toEqual({ env: 'foo' });
    // The same on a write under both: the write is done; the next command meets the refusal.
    writes = [];
    await cmdFollow('serie-a', {}, ctxOf({ competition: 'world-cup', json: true }));
    j = JSON.parse(text());
    expect(j.saved).toEqual({ version: 1, competition: 'ita.1' });
    expect(j.competition).toBeNull();
    expect(j.sources).toEqual({ flag: 'fifa.world' });
    expect(j.refused).toEqual({ env: 'foo' });
    delete process.env.CLAUDINHO_COMPETITION;
  });

  it('a REFUSED flag with a REFUSED environment: both refusals printed, the sentence says both, and the JSON carries both under their names', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    process.env.CLAUDINHO_COMPETITION = 'foo';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'bar' }));
    expect(text()).toMatch(/"bar"/);
    expect(text()).toMatch(/"foo"/);
    expect(text()).not.toMatch(/CLAUDINHO_COMPETITION decides|then the saved choice/);
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is refused/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'bar', json: true }));
    let j = JSON.parse(text());
    expect(j.competition).toBeNull();
    expect(j.sources).toBeUndefined();
    expect(j.refused).toEqual({ flag: 'bar', env: 'foo' });
    expect(j.saved).toEqual({ version: 1, competition: 'eng.1' });
    // On a write under both: done, both refusals still named.
    writes = [];
    await cmdFollow('serie-a', {}, ctxOf({ competition: 'bar', json: true }));
    j = JSON.parse(text());
    expect(j.saved).toEqual({ version: 1, competition: 'ita.1' });
    expect(j.competition).toBeNull();
    expect(j.refused).toEqual({ flag: 'bar', env: 'foo' });
    delete process.env.CLAUDINHO_COMPETITION;
  });

  it('a REFUSED environment with no flag: the refusal is the headline and the sentence says it is refused, never that it is set and wins', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    process.env.CLAUDINHO_COMPETITION = 'bar';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    const lines = text().split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toMatch(/"bar"/);
    expect(text()).not.toMatch(/is set, and it wins|CLAUDINHO_COMPETITION decides/);
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is refused/);
    // The refusal is printed once: as the headline.
    expect(text().split('"bar"').length - 1).toBe(1);
    // The same after a write and after `off` under it.
    writes = [];
    await cmdFollow('serie-a', {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is refused/);
    expect(text()).not.toMatch(/is set, and it wins/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    const j = JSON.parse(text());
    expect(j.competition).toBeNull();
    expect(j.refused).toEqual({ env: 'bar' });
    delete process.env.CLAUDINHO_COMPETITION;
  });

  it('a flag that ran with the environment SET: the JSON names both, so it is not the flag-alone JSON', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup', json: true }));
    const both = JSON.parse(text());
    delete process.env.CLAUDINHO_COMPETITION;
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup', json: true }));
    const alone = JSON.parse(text());
    expect(both.sources).toEqual({ flag: 'fifa.world', env: 'esp.1' });
    expect(alone.sources).toEqual({ flag: 'fifa.world' });
    expect(both).not.toEqual(alone);
  });
});

describe('CLAUDINHO_TEAM has three states: unset, set and readable, set with nothing readable', () => {
  it('a present CLAUDINHO_TEAM with no readable team is in `refused.team` (never in `sources`), the sentence says the team-taking commands refuse it, and the JSON is not the unset one', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    const unset = JSON.parse(text());
    for (const value of ['   ', '\t', '\u200B', '\u{1F600}']) {
      process.env.CLAUDINHO_TEAM = value;
      writes = [];
      await cmdFollow(undefined, {}, ctxOf({ json: true }));
      const j = JSON.parse(text());
      expect(j).not.toEqual(unset);
      expect(j.sources).toBeUndefined();
      expect(j.refused).toEqual({ team: '' });
      expect(j.saved.team).toEqual({ code: 'ESP', name: 'Spain' });
      writes = [];
      await cmdFollow(undefined, {}, ctxOf());
      expect(text()).toMatch(/Saved team: Spain/);
      expect(text()).not.toMatch(/^\s*Team: Spain/m);
      expect(text()).toMatch(/CLAUDINHO_TEAM is set but names no team; the team-taking commands refuse it while it is set\./);
      expect(text()).not.toMatch(/it wins over the saved team/);
    }
    // Without a pin the team-taking commands refuse it all the same: said, and carried.
    delete process.env.CLAUDINHO_TEAM;
    await cmdFollow('world-cup', {}, ctxOf());
    process.env.CLAUDINHO_TEAM = ' ';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    expect(JSON.parse(text()).refused).toEqual({ team: '' });
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_TEAM is set but names no team; the team-taking commands refuse it while it is set\./);
    // A readable value stays in `sources`, with the set sentence.
    process.env.CLAUDINHO_TEAM = 'Mexico';
    writes = [];
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf({ json: true }));
    const j2 = JSON.parse(text());
    expect(j2.sources).toEqual({ team: 'Mexico' });
    expect(j2.refused).toBeUndefined();
    delete process.env.CLAUDINHO_TEAM;
  });
});

describe('with no believed saved choice (no file, a link, an unreadable one), the sentence still says what the next command does', () => {
  it('a flag with the environment set, unset or refused; a refused flag; the environment alone; after `off`: each cell its own sentence, none naming a saved choice', async () => {
    // A flag that ran, the environment set: the next command follows the environment.
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    const envSet = text();
    expect(envSet).toMatch(/Following: World Cup/);
    expect(envSet).toMatch(/--competition decides this command; without it CLAUDINHO_COMPETITION decides\./);
    expect(envSet).not.toMatch(/the saved choice/);
    // The same command with the environment unset: the next command has nothing chosen.
    delete process.env.CLAUDINHO_COMPETITION;
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    const envUnset = text();
    expect(envUnset).not.toEqual(envSet);
    expect(envUnset).toMatch(/--competition decides this command; without it nothing is chosen/);
    expect(envUnset).not.toMatch(/saved choice decides/);
    // A refused flag, the environment set and unset.
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'foo' }));
    expect(text()).toMatch(/"foo"/);
    expect(text()).toMatch(/--competition was refused for this command only; without it CLAUDINHO_COMPETITION decides\./);
    delete process.env.CLAUDINHO_COMPETITION;
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'foo' }));
    expect(text()).toMatch(/--competition was refused for this command only; without it nothing is chosen/);
    // The environment alone: the next command follows it; nothing about a saved choice it wins over.
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/Following: LALIGA/);
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is set, and the next command follows it while it is\./);
    expect(text()).not.toMatch(/over the saved choice/);
    // After `off` the file is gone: the same cell.
    await cmdFollow('world-cup', {}, ctxOf());
    writes = [];
    await cmdFollow('off', {}, ctxOf());
    expect(text()).toMatch(/Saved choice removed/);
    expect(text()).toMatch(/the next command follows it while it is\./);
    expect(text()).not.toMatch(/over the saved choice/);
    // The environment refused, no file: its own sentence, as before.
    process.env.CLAUDINHO_COMPETITION = 'bar';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is refused/);
    delete process.env.CLAUDINHO_COMPETITION;
    // With a file, the sentences that name the saved choice are unchanged.
    await cmdFollow('premier-league', {}, ctxOf());
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/the saved choice decides the next one without it/);
  });
});

describe('the text says every source the JSON names (the fourth reader\'s round-4 forms and survivors)', () => {
  it('a refused flag with the environment set and a file: the sentence names the environment, then the saved choice', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'foo' }));
    expect(text()).toMatch(/"foo"/);
    expect(text()).toMatch(/--competition was refused for this command only; without it CLAUDINHO_COMPETITION decides, then the saved choice\./);
    delete process.env.CLAUDINHO_COMPETITION;
  });

  it('`sources.team` is bounded as a label; an EMPTY CLAUDINHO_TEAM is absent (the pin is the team in effect)', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    process.env.CLAUDINHO_TEAM = 'x'.repeat(100);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    const j = JSON.parse(text());
    expect(j.sources.team.length).toBeLessThanOrEqual(40);
    process.env.CLAUDINHO_TEAM = '';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    const e = JSON.parse(text());
    expect(e.sources).toBeUndefined();
    expect(e.refused).toBeUndefined();
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/^\s*Team: Spain/m);
    expect(text()).not.toMatch(/CLAUDINHO_TEAM/);
    delete process.env.CLAUDINHO_TEAM;
  });

  it('a readable CLAUDINHO_TEAM with NO saved team is said in the text too (the team-taking commands take it), with the "wins over the saved team" sentence kept for a pin', async () => {
    await cmdFollow('world-cup', {}, ctxOf());
    process.env.CLAUDINHO_TEAM = 'Mexico';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_TEAM is set, and the team-taking commands take it as their team while it is\./);
    expect(text()).not.toMatch(/wins over the saved team/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    expect(JSON.parse(text()).sources).toEqual({ team: 'Mexico' });
    // With a pin: the wins sentence, and not the plain one.
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/wins over the saved team/);
    expect(text()).not.toMatch(/take it as their team/);
    delete process.env.CLAUDINHO_TEAM;
  });

  it('`follow off` under a flag that ran names the flag (the no-file cell: without it nothing is chosen)', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    writes = [];
    await cmdFollow('off', {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/Saved choice removed/);
    expect(text()).toMatch(/--competition decides this command; without it nothing is chosen\./);
    writes = [];
    await cmdFollow('off', {}, ctxOf({ competition: 'world-cup', json: true }));
    expect(JSON.parse(text()).sources).toEqual({ flag: 'fifa.world' });
  });
});

describe('the team sentence asks whether the pin APPLIES, not whether the file holds one', () => {
  it('a readable CLAUDINHO_TEAM with a pin for ANOTHER competition than the next command\'s: the plain sentence (the team-taking commands take it), never "wins over the saved team"', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    process.env.CLAUDINHO_TEAM = 'Mexico';
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/Following: LALIGA/);
    expect(text()).toMatch(/Saved team: Spain/);
    expect(text()).toMatch(/the team-taking commands take it as their team while it is\./);
    expect(text()).not.toMatch(/wins over the saved team/);
    // Under a flag naming another competition, with no environment: the
    // sentence is about the NEXT command, which has no flag and follows the
    // saved World Cup, where the pin applies (rule 49): the wins sentence.
    delete process.env.CLAUDINHO_COMPETITION;
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'premier-league' }));
    expect(text()).toMatch(/wins over the saved team/);
    expect(text()).not.toMatch(/take it as their team/);
    // Under the pin's own competition for the NEXT command (the saved choice, with or without this command's flag), the pin applies: the wins sentence.
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/wins over the saved team/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/wins over the saved team/);
    delete process.env.CLAUDINHO_TEAM;
  });
});

describe('the team sentence is about the NEXT command (the one without this command\'s flag)', () => {
  it('under a flag naming the pin\'s competition while the environment names another, the next command has no pin: the plain sentence; the reverse prints the wins one', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    process.env.CLAUDINHO_TEAM = 'Mexico';
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/Following: World Cup/);
    expect(text()).toMatch(/take it as their team/);
    expect(text()).not.toMatch(/wins over the saved team/);
    // The environment names the pin's competition, the flag another: the next command is under the pin's.
    process.env.CLAUDINHO_COMPETITION = 'world-cup';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'laliga' }));
    expect(text()).toMatch(/Following: LALIGA/);
    expect(text()).toMatch(/wins over the saved team/);
    expect(text()).not.toMatch(/take it as their team/);
    delete process.env.CLAUDINHO_COMPETITION;
    delete process.env.CLAUDINHO_TEAM;
  });
});

describe('with-file sentences keep the saved choice (the fourth reader\'s round-5 survivors)', () => {
  it('a refused flag with a file and no environment: "without it the saved choice decides", whole; a flag with the environment set: the environment, then the saved choice; the environment alone: wins over the saved choice', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'foo' }));
    expect(text()).toMatch(/--competition was refused for this command only; without it the saved choice decides\./);
    expect(text()).not.toMatch(/nothing is chosen/);
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/--competition decides this command; without it CLAUDINHO_COMPETITION decides, then the saved choice\./);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is set, and it wins over the saved choice while it is\./);
    delete process.env.CLAUDINHO_COMPETITION;
  });
});

describe('the team sentence promises nothing the next command cannot reach', () => {
  it('when the next command stops on the competition (refused environment, nothing chosen), the team sentences say "once a competition is chosen", never "while it is"', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    process.env.CLAUDINHO_TEAM = 'Mexico';
    // A refused environment: the next command refuses before reaching the team.
    process.env.CLAUDINHO_COMPETITION = 'foo';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is refused/);
    expect(text()).toMatch(/CLAUDINHO_TEAM is set, and the team-taking commands take it as their team once a competition is chosen\./);
    expect(text()).not.toMatch(/while it is\.$/m);
    expect(text()).not.toMatch(/wins over the saved team/);
    // The JSON still names the source as it is.
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup', json: true }));
    expect(JSON.parse(text()).sources).toEqual({ flag: 'fifa.world', team: 'Mexico' });
    delete process.env.CLAUDINHO_COMPETITION;
    // Nothing chosen (no file): under a flag, and alone.
    await cmdFollow('off', {}, ctxOf());
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/without it nothing is chosen\./);
    expect(text()).toMatch(/take it as their team once a competition is chosen\./);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/take it as their team once a competition is chosen\./);
    expect(text()).not.toMatch(/while it is/);
    // An unreadable value, the same: refused once a competition is chosen.
    process.env.CLAUDINHO_TEAM = '   ';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_TEAM is set but names no team; the team-taking commands refuse it once a competition is chosen\./);
    expect(text()).not.toMatch(/refuse it while it is set/);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    expect(JSON.parse(text()).refused).toEqual({ team: '' });
    // When the next command reaches the team, the "while it is" sentences stand.
    process.env.CLAUDINHO_TEAM = 'Mexico';
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/take it as their team while it is\./);
    delete process.env.CLAUDINHO_COMPETITION;
    delete process.env.CLAUDINHO_TEAM;
  });
});

describe('a refused environment has no competition, so no pin (the fourth reader\'s survivor)', () => {
  it('with a readable team and a saved pin, a refused CLAUDINHO_COMPETITION never yields "wins over the saved team", with or without a flag', async () => {
    await cmdFollow('world-cup', { team: 'Spain' }, ctxOf());
    process.env.CLAUDINHO_TEAM = 'Spain';
    process.env.CLAUDINHO_COMPETITION = 'bar';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/"bar"/);
    expect(text()).toMatch(/take it as their team once a competition is chosen\./);
    expect(text()).not.toMatch(/wins over the saved team|while it is\./);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ competition: 'world-cup' }));
    expect(text()).toMatch(/take it as their team once a competition is chosen\./);
    expect(text()).not.toMatch(/wins over the saved team/);
    delete process.env.CLAUDINHO_COMPETITION;
    delete process.env.CLAUDINHO_TEAM;
  });
});
