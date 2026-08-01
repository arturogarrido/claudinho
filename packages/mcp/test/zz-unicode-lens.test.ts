import { describe, it } from 'vitest';
import { toolGetToday } from '../src/tools';
const p = (...a: unknown[]) => process.stderr.write(`ULP ${a.join(' ')}\n`);
const unit = '́ि​'; // Mn + Mc(visible) + ZWSP

const evilVenue = 'Azteca' + unit.repeat(2000);
const espnEvent = {
  id: '700001', date: '2026-06-11T19:00Z', season: { slug: 'group-stage' },
  status: { type: { state: 'in', name: 'IN' }, displayClock: "67'" },
  competitions: [{
    venue: { fullName: evilVenue, address: { city: 'Mexico City', country: 'Mexico' } },
    competitors: [
      { homeAway: 'home', score: '1', team: { id: '1', abbreviation: 'MEX', displayName: 'Mexico' } },
      { homeAway: 'away', score: '0', team: { id: '2', abbreviation: 'RSA', displayName: 'South Africa' } },
    ],
  }],
};

describe('ULP mcp', () => {
  it('an over-long field reaches MCP structuredContent', async () => {
    const g = globalThis as any;
    const realFetch = g.fetch;
    g.fetch = async (url: any) => {
      const u = String(url);
      const body = u.includes('standings') ? { children: [] } : { events: [espnEvent] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const r = await toolGetToday({ date: '2026-06-11', markets: false } as any);
      const m = (r.data as any).matches?.[0];
      p('matches returned  :', (r.data as any).matches?.length, ' count:', (r.data as any).count, ' truncated:', (r.data as any).truncated);
      p('venue code points :', m ? [...m.venue].length : 'n/a');
      p('structuredContent :', Buffer.byteLength(JSON.stringify(r.data)), 'bytes for ONE fixture');
    } finally { g.fetch = realFetch; }
  });
});
