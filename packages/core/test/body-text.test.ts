import { describe, expect, it } from 'vitest';
import { dateUnreached, dateUnreachedSentence } from '../src/bodyText';

/**
 * A dated read that FAILED says "could not reach the provider for <date>" only
 * where it merged no bundled schedule: on the bundle the day's list is the
 * schedule's, known without the provider, and its empty body is the bundle's.
 */
describe('dateUnreached: when an outage is the empty body of a date', () => {
  const date = '2026-10-10';

  it('a failed read with no bundled schedule says the outage, in the reader\'s language', () => {
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      const said = dateUnreached({ degraded: true }, date, lang);
      expect(said, lang).toBe(dateUnreachedSentence(date, lang));
      expect(said, lang).toContain(date);
    }
    expect(dateUnreached({ degraded: true }, date, 'es')).not.toBe(dateUnreached({ degraded: true }, date, 'en'));
  });

  it('a failed read that merged the bundled schedule says nothing here', () => {
    expect(dateUnreached({ degraded: true, skeleton: true }, date, 'en')).toBeUndefined();
  });

  it('a read that answered says nothing here, whole or not', () => {
    expect(dateUnreached({}, date, 'en')).toBeUndefined();
    expect(dateUnreached({ degraded: false, partial: {} }, date, 'en')).toBeUndefined();
    expect(dateUnreached({ partial: { omitted: 2 }, skeleton: true }, date, 'en')).toBeUndefined();
  });
});
