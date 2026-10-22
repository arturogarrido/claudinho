import { createServer } from 'node:http';
import { type AddressInfo, createServer as createNetServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  // highWaterMark 0: a default stream prefetches one chunk on its own, which
  // would count as a pull our reader never asked for.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        spies.pulls += 1;
        const next = queue.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
      cancel() {
        spies.cancels += 1;
      },
    },
    { highWaterMark: 0 },
  );
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
    expect(spies.cancels).toBe(1); // review P3: the refused body is released, not left open
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

/**
 * An error body is released unread (security review, Oct 21, 2026, F4). A
 * non-OK response threw with its body still open: ESPN's abort timer is
 * cleared in `finally`, so nothing ever closed it, and Polymarket's stayed
 * open until its timeout. A provider (or a valid-certificate interposer) that
 * answers an error and keeps writing held the socket and the bandwidth past
 * the request the caller believed ended.
 *
 * A real server on the loopback interface, a real `fetch`: the server answers
 * the status, then writes 1 KiB every 5 ms, forever. The consequence observed
 * is the server's own: every response it opened closes BEFORE it has written
 * 200 more chunks after the call returned. Each response the adapter received
 * is held by the test, so a collected (unreferenced) body cannot close it on
 * the red side by chance; the timeouts are a minute, so no timer can either.
 */
interface Endless {
  url: string;
  requests: number;
  writes: number;
  closed: Promise<void>[];
  onWrite?: () => void;
  stop(): Promise<void>;
}

async function endlessServer(status: number, headers: Record<string, string> = {}): Promise<Endless> {
  const state = { requests: 0, writes: 0, closed: [] as Promise<void>[] } as Endless;
  const server = createServer((_req, res) => {
    state.requests += 1;
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.write('{"message":"');
    const timer = setInterval(() => {
      state.writes += 1;
      res.write('x'.repeat(1024));
      state.onWrite?.();
    }, 5);
    state.closed.push(
      new Promise<void>((resolve) =>
        res.on('close', () => {
          clearInterval(timer);
          resolve();
        }),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${port}/`;
  state.stop = () => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return state;
}

/**
 * The same server written in raw HTTP, for a response `node:http` will not
 * send: a 205 with a body. `fetch` hands such a response over with
 * `body: null`, so there is no stream to cancel, while its transfer runs on.
 * `framing: 'chunked'` writes chunked frames; `{ length }` declares a
 * Content-Length and writes raw bytes toward it.
 */
async function rawEndlessServer(statusLine: string, framing: 'chunked' | { length: number }): Promise<Endless> {
  const state = { requests: 0, writes: 0, closed: [] as Promise<void>[] } as Endless;
  const sockets = new Set<Socket>();
  const server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    let timer: ReturnType<typeof setInterval> | undefined;
    state.closed.push(
      new Promise<void>((resolve) =>
        socket.on('close', () => {
          clearInterval(timer);
          sockets.delete(socket);
          resolve();
        }),
      ),
    );
    socket.once('data', () => {
      state.requests += 1;
      const declared = framing === 'chunked' ? 'Transfer-Encoding: chunked' : `Content-Length: ${framing.length}`;
      socket.write(`HTTP/1.1 ${statusLine}\r\nContent-Type: application/json\r\n${declared}\r\n\r\n`);
      const chunk = 'x'.repeat(1024);
      timer = setInterval(() => {
        state.writes += 1;
        socket.write(framing === 'chunked' ? `400\r\n${chunk}\r\n` : chunk);
        state.onWrite?.();
      }, 5);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${port}/`;
  state.stop = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return state;
}

/** 'closed' once every response the server opened has closed; 'open' once it wrote `more` chunks first. */
function settles(s: Endless, more = 200): Promise<'closed' | 'open'> {
  const start = s.writes;
  const open = new Promise<'open'>((resolve) => {
    s.onWrite = () => {
      if (s.writes - start >= more) resolve('open');
    };
  });
  const closed = Promise.all(s.closed).then(() => 'closed' as const);
  return Promise.race([closed, open]);
}

/** The real `fetch`, aimed at the local server whatever URL the caller built; every response held. */
function toServer(s: Endless, held: Response[]): FetchImpl {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const res = await fetch(s.url, init);
    held.push(res);
    return res;
  }) as FetchImpl;
}

describe('an error body is released unread (F4)', () => {
  const servers: Endless[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });
  const serve = async (status: number, headers?: Record<string, string>) => {
    const s = await endlessServer(status, headers);
    servers.push(s);
    return s;
  };

  it('ESPN: a 500 with an unending body is closed when the call fails', async () => {
    const s = await serve(500);
    const held: Response[] = [];
    const adapter = new EspnAdapter({ enrichGroups: false, timeoutMs: 60_000, fetchImpl: toServer(s, held) });
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({ kind: 'http', status: 500 });
    expect(s.requests).toBeGreaterThan(0);
    expect(held.length).toBe(s.requests);
    expect(await settles(s)).toBe('closed');
  });

  it('ESPN: a 429 with an unending body is closed, and the throttle is armed as before', async () => {
    const s = await serve(429, { 'retry-after': '30' });
    const held: Response[] = [];
    const T = Date.UTC(2026, 9, 21, 12);
    const adapter = new EspnAdapter({
      enrichGroups: false,
      timeoutMs: 60_000,
      now: () => T,
      fetchImpl: toServer(s, held),
    });
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({
      throttled: true,
      status: 429,
      retryAfterMs: 30_000,
    });
    expect(await settles(s)).toBe('closed');
    // The cooldown holds under the injected clock: the next call asks nothing.
    const asked = s.requests;
    await expect(adapter.fetchByDate('2026-09-16')).rejects.toMatchObject({ throttled: true, status: 429 });
    expect(s.requests).toBe(asked);
  });

  // Round 1 of the review: a 205 arrives with `body: null`, so cancelling a
  // stream reaches nothing; the failed call must end the request itself.
  const serveRaw = async (statusLine: string, framing: 'chunked' | { length: number }) => {
    const s = await rawEndlessServer(statusLine, framing);
    servers.push(s);
    return s;
  };

  it('ESPN: a 205 whose body never ends (no stream to cancel) is closed when the read fails', async () => {
    const s = await serveRaw('205 Reset Content', 'chunked');
    const held: Response[] = [];
    const adapter = new EspnAdapter({ enrichGroups: false, timeoutMs: 60_000, fetchImpl: toServer(s, held) });
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({ kind: 'parse' });
    expect(held.length).toBe(s.requests);
    expect(held.every((r) => r.body === null)).toBe(true);
    expect(await settles(s)).toBe('closed');
  });

  it('ESPN: a 205 declaring a length over the cap is closed when it is refused', async () => {
    const s = await serveRaw('205 Reset Content', { length: MAX_RESPONSE_BYTES + 1 });
    const held: Response[] = [];
    const adapter = new EspnAdapter({ enrichGroups: false, timeoutMs: 60_000, fetchImpl: toServer(s, held) });
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({ kind: 'parse' });
    expect(adapter.lastError?.message).toMatch(/too large/);
    expect(await settles(s)).toBe('closed');
  });

  const fixture: Match = {
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

  for (const status of [404, 500]) {
    it(`Polymarket: a ${status} with an unending body is closed when the lookup answers`, async () => {
      const s = await serve(status);
      const held: Response[] = [];
      const provider = new PolymarketProvider({
        fetchImpl: toServer(s, held),
        now: new Date('2026-06-11T15:00:00Z'),
      });
      await expect(
        provider.findSignal(fixture, { deadlineMs: 60_000, timeoutMs: 60_000 }),
      ).resolves.toBeUndefined();
      expect(s.requests).toBeGreaterThan(0);
      expect(held.length).toBe(s.requests);
      expect(await settles(s)).toBe('closed');
    });
  }

  it('Polymarket: a 205 whose body never ends (no stream to cancel) is closed when the lookup answers', async () => {
    const s = await serveRaw('205 Reset Content', 'chunked');
    const held: Response[] = [];
    const provider = new PolymarketProvider({
      fetchImpl: toServer(s, held),
      now: new Date('2026-06-11T15:00:00Z'),
    });
    await expect(provider.findSignal(fixture, { deadlineMs: 60_000, timeoutMs: 60_000 })).resolves.toBeUndefined();
    expect(s.requests).toBeGreaterThan(0);
    expect(held.every((r) => r.body === null)).toBe(true);
    expect(await settles(s)).toBe('closed');
  });
});
