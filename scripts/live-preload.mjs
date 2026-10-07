/**
 * The LIVE preload of `scripts/verify.mjs` (the verify-claudinho skill's
 * control CLI), for `--live` only: a person asking the real provider on
 * purpose, never an agent mid-task. Loaded in every child through
 * NODE_OPTIONS (`--import <this file>`, an absolute path), it keeps the saved
 * `fetch` and only RECORDS: every attempt goes to the provider unchanged, and
 * two JSON lines `{ "url", "mode": "live", "outcome" }` are appended to the
 * file VERIFY_FETCH_LOG names: `live:sent` BEFORE the request (so a request
 * that never settles, or a process that exits while it is in flight, still
 * leaves its attempt), then, once it settles, `live:<status>` for a response or
 * `live:error` for a request that got none (the error is rethrown as it came).
 *
 * A log that cannot be written is SAID: one line `verify-preload: could not
 * record <outcome> for <url>: <error>` on this process's stderr (the control
 * CLI fails the phase that carries it), and the request is answered as it is.
 */
import { appendFileSync, writeSync } from 'node:fs';

const log = process.env.VERIFY_FETCH_LOG;
const saved = globalThis.fetch;

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

/** One line per step of an attempt; a log that cannot be written is said on stderr and never changes the request. */
function record(url, outcome) {
  if (!log) return;
  try {
    appendFileSync(log, `${JSON.stringify({ url, mode: 'live', outcome })}\n`);
  } catch (e) {
    // The request goes, or already went, as it would; the stderr says the step was not recorded.
    try {
      writeSync(2, `verify-preload: could not record ${outcome} for ${url}: ${e?.message ?? e}\n`);
    } catch {
      // No stderr to say it on.
    }
  }
}

globalThis.fetch = async function liveFetch(input, init) {
  const url = urlOf(input);
  record(url, 'live:sent');
  let response;
  try {
    response = await saved(input, init);
  } catch (e) {
    record(url, 'live:error');
    throw e;
  }
  record(url, `live:${response.status}`);
  return response;
};
