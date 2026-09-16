/**
 * The ONE bounded JSON reader for provider responses (audit A11).
 *
 * A declared Content-Length is the cheap early exit; an undeclared (chunked)
 * body used to be materialised in full before any cap applied, so a hijacked
 * or misbehaving upstream could balloon the refresher's memory every cycle.
 * Now the bytes actually consumed from the stream are counted, the read stops
 * and cancels at the cap, and parsing happens only after the whole body has
 * passed the bound. Test doubles without a body stream (`{ ok, json }`) still
 * work: they carry no bytes to bound.
 */

export class ResponseTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`response body exceeds ${limit} bytes (${bytes} seen)`);
    this.name = 'ResponseTooLargeError';
  }
}

type ResponseLike = {
  headers?: { get?: (name: string) => string | null };
  body?: unknown;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

function isStream(v: unknown): v is ReadableStream<Uint8Array> {
  return typeof (v as ReadableStream | undefined)?.getReader === 'function';
}

/** Parse a JSON body of at most `maxBytes`, counting what is actually read. */
export async function readJsonBounded(res: Response, maxBytes: number): Promise<unknown> {
  const r = res as unknown as ResponseLike;
  const declared = Number(r.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ResponseTooLargeError(declared, maxBytes);
  }
  if (isStream(r.body)) {
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ResponseTooLargeError(total, maxBytes);
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  }
  if (typeof r.text === 'function') {
    const text = await r.text();
    const size = Buffer.byteLength(text);
    if (size > maxBytes) throw new ResponseTooLargeError(size, maxBytes);
    return JSON.parse(text);
  }
  if (typeof r.json === 'function') return r.json();
  throw new TypeError('response has no readable body');
}
