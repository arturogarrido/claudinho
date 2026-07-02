import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdTeam } from '../src/commands';
import { makeT } from '../src/i18n';
import type { CliConfig } from '../src/config';

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: undefined, json: false, color: false, source: 'espn', flavor: 'full', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT((over.lang as string) ?? 'en') });

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('cmdTeam', () => {
  it('--json emits { query, team, matches, count } for a confident match', () => {
    cmdTeam('mexico', ctx({ json: true }));
    const j = JSON.parse(text());
    expect(j).toMatchObject({ query: 'mexico', count: 1 });
    expect(j.team).toMatchObject({ code: 'MEX', name: 'Mexico', group: 'A' });
    expect(j.matches).toHaveLength(1);
    // JSON stays machine-clean (no ANSI); it's structured data.
    expect(text()).not.toContain('[');
  });

  it('resolves an alias + code + accent in text output', () => {
    cmdTeam('DR Congo', ctx());
    expect(text()).toContain('COD');
    expect(text()).toContain('Congo DR');
    expect(text()).toContain('Not affiliated');
  });

  it('lists candidates for an ambiguous query', () => {
    cmdTeam('south', ctx());
    expect(text()).toMatch(/ambiguous/i);
    expect(text()).toContain('RSA');
    expect(text()).toContain('KOR');
  });

  it('reports no match for an unknown query (fail-closed, still disclaimed)', () => {
    cmdTeam('zzz', ctx());
    expect(text()).toMatch(/No team found/i);
    expect(text()).toContain('Not affiliated');
  });

  it('localizes labels (es): Grupo + Spanish disclaimer, team facts unchanged', () => {
    cmdTeam('Turkey', ctx({ lang: 'es' }));
    expect(text()).toContain('TUR');
    expect(text()).toContain('Türkiye');
    expect(text()).toContain('Grupo D');
    expect(text()).toMatch(/No afiliado/);
  });
});
