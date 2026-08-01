/**
 * The hook's "+N" is a claim about MATCHES, in Claude's context.
 *
 * The statusline had this bug and got this fix (475975a); the hook kept the
 * shape-only count. Fixing one surface and not its sibling is the recurring
 * mistake in this codebase, which is why both now share the same two sources:
 * matches sealed but not shown, plus records past the examine cap we never
 * looked at. A record we examined and rejected is neither.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '../src/hook';
import { renderPrompt } from '../src/statusline';

const NOW = new Date('2026-06-20T20:00:00Z');
const real = {
  id: '700123', stage: 'GROUP', kickoff: '2026-06-20T19:00:00Z', venue: 'V',
  home: { code: 'MEX', name: 'Mexico' }, away: { code: 'RSA', name: 'South Africa' },
  score: { home: 1, away: 0 }, minute: 55, status: 'LIVE', updatedAt: '2026-06-20T19:59:00Z',
};
/** Passes the cheap shape test (LIVE + two codes) but cannot be sealed. */
const junk = { status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } };
const state = (live: unknown[]) =>
  ({ version: 2, updatedAt: '2026-06-20T19:59:30Z', live, degraded: false,
     source: 'espn', competition: 'fifa.world' }) as never;

describe('the hook does not report phantom matches to the model', () => {
  it('records it examined and rejected are not "more not shown"', () => {
    const out = renderHook(state([real, ...Array.from({ length: 60 }, () => ({ ...junk }))]), {
      now: NOW,
    });
    expect(out).toContain('Mexico');
    expect(out).not.toMatch(/\+\d+ more/); // was "(+60 more not shown)"
  });

  it('but records it never examined ARE reported — stopping early is not silence', () => {
    const out = renderHook(state([real, ...Array.from({ length: 199 }, () => ({ ...junk }))]), {
      now: NOW,
    });
    expect(out).toMatch(/\+\d+ more/);
  });

  it('and genuinely hidden matches are still counted', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...real, id: String(700200 + i) }));
    expect(renderHook(state(many), { now: NOW })).toMatch(/\+\d+ more/);
  });
});

describe('a snapshot stamped in the future is not fresh', () => {
  const live = {
    id: '700000', stage: 'GROUP', kickoff: '2026-06-20T19:00:00Z', venue: 'V',
    home: { code: 'MEX', name: 'Mexico' }, away: { code: 'RSA', name: 'South Africa' },
    score: { home: 1, away: 0 }, minute: 55, status: 'LIVE',
    updatedAt: '2026-06-20T19:59:00Z',
  };
  const at = (updatedAt: string) =>
    ({ version: 2, updatedAt, live: [live], degraded: false,
       source: 'espn', competition: 'fifa.world' }) as never;

  it('does not render a future-dated cache as a live score', () => {
    // A negative age compared below every staleness threshold, so a snapshot
    // dated 2099 stayed "fresh" forever and no refresh superseded it —
    // fail-OPEN on the one field that decides whether we trust the file.
    expect(renderPrompt(at('2099-01-01T00:00:00Z'), { now: NOW })).not.toContain('1–0');
  });

  it('still tolerates ordinary clock skew between writing and reading', () => {
    expect(renderPrompt(at('2026-06-20T19:59:30Z'), { now: NOW })).toContain('1–0');
    expect(renderPrompt(at('2026-06-20T20:00:30Z'), { now: NOW })).toContain('1–0');
  });
});
