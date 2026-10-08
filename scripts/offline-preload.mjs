/**
 * The OFFLINE preload of `scripts/verify.mjs` (the verify-claudinho skill's
 * control CLI): loaded in every child through NODE_OPTIONS (`--import <this
 * file>`, an absolute path), it replaces `globalThis.fetch` so that NO request
 * leaves the process. Every attempt is logged first, one JSON line
 * `{ "url", "mode": "offline", "outcome": "blocked" }` appended to the file
 * VERIFY_FETCH_LOG names, and then rejected with a network failure:
 * `TypeError: fetch failed (offline by verify.mjs)`.
 *
 * Never a Response: an HTTP-shaped 403 or 429 would be read as a provider
 * throttle and persist a backoff into the run's cache; a rejection is what an
 * unplugged cable looks like, so the product renders its outage path.
 *
 * A log that cannot be written is SAID: one line `verify-preload: could not
 * record <outcome> for <url>: <error>` on this process's stderr (the control
 * CLI fails the phase that carries it), and the attempt is still rejected.
 */
import { appendFileSync, writeSync } from 'node:fs';

const log = process.env.VERIFY_FETCH_LOG;

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

/** One line per attempt; a log that cannot be written is said on stderr and never lets a request through. */
function record(url, outcome) {
  if (!log) return;
  try {
    appendFileSync(log, `${JSON.stringify({ url, mode: 'offline', outcome })}\n`);
  } catch (e) {
    // The rejection below still happens: an unrecorded attempt is still blocked, and the stderr says it was not recorded.
    try {
      writeSync(2, `verify-preload: could not record ${outcome} for ${url}: ${e?.message ?? e}\n`);
    } catch {
      // No stderr to say it on.
    }
  }
}

globalThis.fetch = async function offlineFetch(input) {
  record(urlOf(input), 'blocked');
  throw new TypeError('fetch failed (offline by verify.mjs)');
};
