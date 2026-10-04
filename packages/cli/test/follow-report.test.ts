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
  it('a present CLAUDINHO_TEAM with no readable team is in `refused.team` (never in `sources`), the sentence says the next command refuses it, and the JSON is not the unset one', async () => {
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
      expect(text()).toMatch(/CLAUDINHO_TEAM is set but names no team/);
      expect(text()).not.toMatch(/it wins over the saved team/);
    }
    // Without a pin the next command refuses it all the same: said, and carried.
    delete process.env.CLAUDINHO_TEAM;
    await cmdFollow('world-cup', {}, ctxOf());
    process.env.CLAUDINHO_TEAM = ' ';
    writes = [];
    await cmdFollow(undefined, {}, ctxOf({ json: true }));
    expect(JSON.parse(text()).refused).toEqual({ team: '' });
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/CLAUDINHO_TEAM is set but names no team/);
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
