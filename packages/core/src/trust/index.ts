/**
 * The trust boundary — the ONLY place untrusted JSON becomes a domain type.
 *
 * Feed responses and cache files enter here as `unknown` and leave as `Match`,
 * `Team`, `MarketSignal` or nothing. Adapters and cache readers may call these
 * constructors; nothing else may build a domain object from raw input.
 *
 * Ten rounds of review kept finding the same four asymmetries, and each one is
 * a thing this module makes structurally impossible rather than defended:
 *
 *   PATH      — live and cache used different rules for the same value, so a
 *               fix on one path left the other open. Now both call the same
 *               constructor, and a property test asserts they agree.
 *   DIMENSION — record counts were bounded while nested arrays, field bytes and
 *               CPU work were not. `takeBounded` bounds work BEFORE the work.
 *   EXEMPTION — "keep emoji whole" had no positive grammar, so TAG, then
 *               variation selectors, then ZWJ each rode through it. Flags are
 *               now generated, never accepted, so there is no exemption at all.
 *   DOC       — SECURITY.md claimed properties the tests did not pin. The
 *               property suite is now named after the claims.
 */
export * from './result';
export * from './bounded';
export * from './batch';
export * from './roles';
export * from './match';
export * from './market';
export * from './espn';
