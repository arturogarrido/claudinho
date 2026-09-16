import { describe, expect, it, vi } from 'vitest';
import { EspnAdapter, MAX_RESPONSE_BYTES } from '../src/adapters/espn';
import { readJsonBounded, ResponseTooLargeError } from '../src/adapters/http';
import { PolymarketProvider } from '../src/markets/polymarket';
import type { Match } from '../src/types';

/**
 * Audit A11 (P2): the 5 MiB response cap only checked the declared
 * Content-Length, so an undeclared (chunked) body was materialised in full
 * before parsing (repro: a 5,242,907-byte Response with no Content-Length was
 * accepted against a 5,242,880-byte ceiling). Now ONE reader counts the bytes
 * actually consumed from the stream, cancels at the cap, and only then parses.
 * Assertions are on bytes and calls, never wall-clock.
 */
type FetchImpl = typeof fetch;
const CAP = 1024; // a small cap keeps the fixtures readable; the rule is size-agnostic

function streamed(chunks: Uint8Array[], spies: { pulls: number; cancels: number }, headers: Record<string, string> = {}): Response {
  const queue = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      spies.pulls += 1;
      const next = queue.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel() {
      spies.cancels += 1;
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/json', ...headers } });
}
const bytes = (s: string) => new TextEncoder().encode(s);

describe('readJsonBounded', () => {
  it('stops reading at the cap, cancels the stream, and never parses', async () => {
    const spies = { pulls: 0, cancels: 0 };
    // Ten 256-byte chunks = 2,560 bytes against a 1,024 cap: the reader must stop
    // by the fifth chunk and never pull the rest.
    const res = streamed(Array.from({ length: 10 }, () => bytes('x'.repeat(256))), spies);
    const parse = vi.spyOn(JSON, 'parse');
    await expect(readJsonBounded(res, CAP)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(parse).not.toHaveBeenCalled();
    expect(spies.pulls).toBeLessThanOrEqual(5);
    expect(spies.cancels).toBe(1);
    parse.mockRestore();
  });

  it('a body one byte under the cap parses', async () => {
    const spies = { pulls: 0, cancels: 0 };
    const pad = 'x'.repeat(CAP - 1 - '{"pad":""}'.length);
    const res = streamed([bytes(`{"pad":"${pad}"}`)], spies);
    await expect(readJsonBounded(res, CAP)).resolves.toEqual({ pad });
    expect(spies.cancels).toBe(0);
  });

  it('a declared oversize header is refused before a single byte is read', async () => {
    const spies = { pulls: 0, cancels: 0 };
    const res = streamed([bytes('{}')], spies, { 'content-length': String(CAP + 1) });
    await expect(readJsonBounded(res, CAP)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(spies.pulls).toBe(0);
  });

  it('a Response-like fake without a body stream still parses (test doubles keep working)', async () => {
    const fake = { ok: true, json: async () => ({ events: [] }) } as unknown as Response;
    await expect(readJsonBounded(fake, CAP)).resolves.toEqual({ events: [] });
  });
});

const oversized = () =>
  new Response(JSON.stringify({ events: [], padding: 'x'.repeat(MAX_RESPONSE_BYTES + 1) }), {
    headers: { 'content-type': 'application/json' },
  });

describe('the adapters use the bounded reader (the audit repro)', () => {
  it('ESPN: 5,242,907 undeclared bytes are refused as a parse failure, not accepted as []', async () => {
    const res = oversized();
    expect(res.headers.get('content-length')).toBeNull();
    const adapter = new EspnAdapter({ enrichGroups: false, fetchImpl: (async () => res) as FetchImpl });
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({ kind: 'parse' });
    expect(adapter.lastError?.message).toMatch(/too large/);
  });

  it('Polymarket: the same body yields no signal and is never parsed', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    const provider = new PolymarketProvider({
      fetchImpl: (async () => oversized()) as FetchImpl,
      now: new Date('2026-06-11T15:00:00Z'),
    });
    const match: Match = {
      id: '760415',
      stage: 'GROUP',
      group: 'A',
      kickoff: '2026-06-11T19:00Z',
      venue: 'Estadio Banorte',
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
      status: 'SCHEDULED',
      updatedAt: '2026-06-01T00:00Z',
    };
    await expect(provider.findSignal(match)).resolves.toBeUndefined();
    const huge = parse.mock.calls.some(([s]) => typeof s === 'string' && s.length > MAX_RESPONSE_BYTES);
    expect(huge).toBe(false);
    parse.mockRestore();
  });
});
