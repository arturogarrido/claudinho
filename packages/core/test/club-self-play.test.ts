import { describe, expect, it } from 'vitest';
import { parseEspnEvent } from '../src/trust/espn';

/**
 * Audit A04 (P2), the part fixed now: the self-play refusal compared provider
 * ids only when BOTH sides resolved to a known nation. A club has no nation
 * flag, so it is an unresolved slot, so two slots carrying the SAME provider
 * id — `Arsenal` vs `Arsenal FC`, id 359 on both sides (repro S5) — were
 * accepted as a fixture. The id is the provider's identity regardless of
 * whether we can flag the entity. The rest of A04 (stable ids on `Team`, club
 * rendering, league stage labels) is 0.11 scope (2.0 / 2.2 / 2.4).
 */
const event = (homeId: string, awayId: string) => ({
  id: '999999002',
  date: '2026-09-16T20:00:00.000Z',
  season: { slug: 'regular-season' },
  status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
  competitions: [
    {
      competitors: [
        { homeAway: 'home', team: { id: homeId, abbreviation: 'ARS', displayName: 'Arsenal' } },
        { homeAway: 'away', team: { id: awayId, abbreviation: 'ARS', displayName: 'Arsenal FC' } },
      ],
    },
  ],
});

describe('self-play by provider id, whatever the kind', () => {
  it('the audit repro: the same club id on both sides is refused', () => {
    expect(parseEspnEvent(event('359', '359')).kind).not.toBe('valid');
  });

  it('two distinct ids sharing an abbreviation stay two clubs', () => {
    expect(parseEspnEvent(event('359', '360')).kind).toBe('valid');
  });
});
