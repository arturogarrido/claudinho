import { describe, expect, it } from 'vitest';
import type { CacheState } from '../src/cache';
import { renderHook } from '../src/hook';
import {
  liveMatchCountFromCache,
  liveMatchesFromCache,
  renderPrompt,
} from '../src/statusline';

const NOW = new Date('2026-06-20T20:00:00Z');

const real = {
  id: '700123',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-20T19:00:00Z',
  venue: 'Estadio Azteca',
  home: { code: 'MEX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}' },
  away: { code: 'RSA', name: 'South Africa', flag: '\u{1F1FF}\u{1F1E6}' },
  score: { home: 1, away: 0 },
  minute: 55,
  status: 'LIVE',
  updatedAt: '2026-06-20T19:59:00Z',
};

const filler = { status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } };

function state(): CacheState {
  return {
    version: 2,
    updatedAt: '2026-06-20T19:59:30Z',
    live: [real, ...Array.from({ length: 99 }, () => ({ ...filler }))] as never,
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
  };
}

describe('claimed defect repro', () => {
  it('counts vs seals', () => {
    const s = state();
    const count = liveMatchCountFromCache(s, NOW.getTime());
    const sealed = liveMatchesFromCache(s, NOW.getTime());
    console.log('cheap count =', count, ' sealed length =', sealed.length);
    console.log('PROMPT:', JSON.stringify(renderPrompt(s, { now: NOW })));
    console.log('HOOK:', JSON.stringify(renderHook(s, { now: NOW })));
    expect(count).toBeTypeOf('number');
  });

  it('all-sealable equivalent (attacker with same write access)', () => {
    const s = state();
    s.live = [
      real,
      ...Array.from({ length: 99 }, (_, i) => ({
        ...real,
        id: String(800000 + i),
        home: { code: 'AAA', name: 'Aaa', flag: '' },
        away: { code: 'BBB', name: 'Bbb', flag: '' },
      })),
    ] as never;
    console.log(
      'all-sealable count =',
      liveMatchCountFromCache(s, NOW.getTime()),
      ' sealed =',
      liveMatchesFromCache(s, NOW.getTime()).length,
    );
    console.log('PROMPT:', JSON.stringify(renderPrompt(s, { now: NOW })));
    console.log('HOOK head:', JSON.stringify(renderHook(s, { now: NOW }).split('\n').slice(-1)));
  });
});
