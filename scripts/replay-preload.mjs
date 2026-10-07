/**
 * The REPLAY preload of `scripts/verify.mjs` (the verify-claudinho skill's
 * control CLI), and the one reader of the parity format: loaded in every child
 * through NODE_OPTIONS (`--import <this file>`, an absolute path), it replaces
 * `globalThis.fetch` with a reader of a recorded corpus and never asks the
 * network.
 *
 * The corpus is the directory VERIFY_REPLAY_CORPUS names. The recording for a
 * URL is `<corpus>/<key>.json`, the key the first 24 hex characters of the
 * URL's sha256; under PARITY_SYNTHETIC=1, `<corpus>/synthetic/<key>.json` is
 * served INSTEAD when it exists (so a recorded refusal keeps its raw status
 * unless the synthetic set is asked for). A recording is the envelope
 * `{ "url", "status", "body" }`, VALID only when it parses as JSON, `url` is a
 * string equal to the requested URL, `status` an integer from 100 to 599 and
 * `body` a string (the response bytes); it is served as
 * `new Response(body, { status, headers: { 'content-type': 'application/json' } })`.
 * Bytes inside a valid string body are served unchanged, whatever they are: a
 * provider's malformed payload is the product's case, not the reader's.
 *
 * Every attempt is logged, one JSON line `{ "url", "mode": "replay", "outcome" }`
 * appended to the file VERIFY_FETCH_LOG names (the run's own log; the corpus is
 * never written), the outcome one of `replayed:raw`, `replayed:synthetic`,
 * `miss` (no recording for the key) or `malformed` (a file that cannot be read,
 * is not JSON, fails a type rule, or a Response that cannot be built). A miss
 * and a malformed recording reject as the offline preload does, with a network
 * failure, never a status.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const log = process.env.VERIFY_FETCH_LOG;
const corpus = process.env.VERIFY_REPLAY_CORPUS;
const synthetic = process.env.PARITY_SYNTHETIC === '1';

/** The URL a `fetch` was asked for, whatever form its first argument took. */
function urlOf(input) {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === 'string') return input.url;
    return String(input);
  } catch {
    return '(unreadable)';
  }
}

/** One line per attempt; a log that cannot be written never changes what is served. */
function record(url, outcome) {
  if (!log) return;
  try {
    appendFileSync(log, `${JSON.stringify({ url, mode: 'replay', outcome })}\n`);
  } catch {
    // An unrecorded attempt is still decided as below.
  }
}

/** The parity key of a URL: the first 24 hex characters of its sha256. */
export function replayKey(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

/**
 * Reads one recording: `{ kind: 'absent' }` when there is no file,
 * `{ kind: 'malformed' }` when it cannot be read or fails a rule, else
 * `{ kind: 'valid', status, body }`.
 */
export function readRecording(path, url) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return e && e.code === 'ENOENT' ? { kind: 'absent' } : { kind: 'malformed' };
  }
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return { kind: 'malformed' };
  }
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return { kind: 'malformed' };
  if (typeof env.url !== 'string' || env.url !== url) return { kind: 'malformed' };
  if (!Number.isInteger(env.status) || env.status < 100 || env.status > 599) return { kind: 'malformed' };
  if (typeof env.body !== 'string') return { kind: 'malformed' };
  return { kind: 'valid', status: env.status, body: env.body };
}

/** What the corpus says about a URL: the outcome to log and, when served, the Response. */
export function decide(url, dir = corpus, useSynthetic = synthetic) {
  if (!dir) return { outcome: 'miss' };
  const key = replayKey(url);
  let rec = { kind: 'absent' };
  let outcome = 'replayed:raw';
  if (useSynthetic) {
    rec = readRecording(join(dir, 'synthetic', `${key}.json`), url);
    outcome = 'replayed:synthetic';
  }
  if (rec.kind === 'absent') {
    rec = readRecording(join(dir, `${key}.json`), url);
    outcome = 'replayed:raw';
  }
  if (rec.kind === 'absent') return { outcome: 'miss' };
  if (rec.kind === 'malformed') return { outcome: 'malformed' };
  try {
    const response = new Response(rec.body, { status: rec.status, headers: { 'content-type': 'application/json' } });
    return { outcome, response };
  } catch {
    // A status a Response refuses with a body (101, 204, 205, 304), for one.
    return { outcome: 'malformed' };
  }
}

globalThis.fetch = async function replayFetch(input) {
  const url = urlOf(input);
  const { outcome, response } = decide(url);
  record(url, outcome);
  if (response) return response;
  throw new TypeError(`fetch failed (replay ${outcome} by verify.mjs)`);
};
