/**
 * The LIVE preload of `scripts/verify.mjs` (the verify-claudinho skill's
 * control CLI), for `--live` only: a person asking the real provider on
 * purpose, never an agent mid-task. Loaded in every child through
 * NODE_OPTIONS (`--import <this file>`, an absolute path), it keeps the saved
 * `fetch` and only RECORDS: every attempt goes to the provider unchanged, and
 * one JSON line `{ "url", "mode": "live", "outcome" }` is appended to the file
 * VERIFY_FETCH_LOG names once it settles, the outcome `live:<status>` for a
 * response or `live:error` for a request that got none (the error is
 * rethrown as it came).
 */
import { appendFileSync } from 'node:fs';

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

/** One line per attempt; a log that cannot be written never changes the request. */
function record(url, outcome) {
  if (!log) return;
  try {
    appendFileSync(log, `${JSON.stringify({ url, mode: 'live', outcome })}\n`);
  } catch {
    // The request already went; an unrecorded attempt is still answered.
  }
}

globalThis.fetch = async function liveFetch(input, init) {
  const url = urlOf(input);
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
