import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { mergeLive } from '../src/data';
import type { Match } from '@claudinho/core';

const ORIG = { ...process.env };
beforeEach(() => {
  delete process.env.CLAUDINHO_LANG;
  delete process.env.CLAUDINHO_TZ;
  delete process.env.CLAUDINHO_SOURCE;
  delete process.env.NO_COLOR;
  delete process.env.LANG;
});
afterEach(() => {
  process.env = { ...ORIG };
});

describe('resolveConfig', () => {
  it('defaults sensibly', () => {
    const c = resolveConfig({});
    expect(c.lang).toBe('en');
    expect(c.source).toBe('espn');
    expect(c.json).toBe(false);
  });

  it('prefers explicit lang over env', () => {
    process.env.CLAUDINHO_LANG = 'pt';
    expect(resolveConfig({}).lang).toBe('pt'); // from env
    expect(resolveConfig({ lang: 'es' }).lang).toBe('es'); // explicit wins
  });

  it('falls back to en for an unsupported lang with no env/system locale', () => {
    // no CLAUDINHO_LANG, no LANG set (cleared in beforeEach)
    expect(resolveConfig({ lang: 'xx' }).lang).toBe('en');
    expect(resolveConfig({}).lang).toBe('en');
  });

  it('derives lang from POSIX LANG', () => {
    process.env.LANG = 'fr_FR.UTF-8';
    expect(resolveConfig({}).lang).toBe('fr');
  });

  it('disables color under NO_COLOR or --no-color', () => {
    process.env.NO_COLOR = '1';
    expect(resolveConfig({}).color).toBe(false);
    delete process.env.NO_COLOR;
    expect(resolveConfig({ color: false }).color).toBe(false);
  });

  it('reads tz from env', () => {
    process.env.CLAUDINHO_TZ = 'America/Mexico_City';
    expect(resolveConfig({}).tz).toBe('America/Mexico_City');
  });
});

describe('makeT', () => {
  it('translates and interpolates', () => {
    const t = makeT('es');
    expect(t('live.title')).toBe('En vivo');
    expect(t('next.in', { countdown: '2h10m' })).toBe('en 2h10m');
  });
  it('falls back to English for missing keys/locales', () => {
    const t = makeT('zz');
    expect(t('live.title')).toBe('Live now');
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });
});

describe('mergeLive', () => {
  const base: Match = {
    id: '1',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'X',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-11T10:00Z',
  };

  it('overlays live state onto the static base by id', () => {
    const live: Match = { ...base, status: 'LIVE', minute: 67, score: { home: 1, away: 0 } };
    const merged = mergeLive([base], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe('LIVE');
    expect(merged[0]!.score).toEqual({ home: 1, away: 0 });
  });

  it('keeps base entries with no live counterpart', () => {
    const merged = mergeLive([base], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe('SCHEDULED');
  });
});
