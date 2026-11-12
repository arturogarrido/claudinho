import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';

/**
 * The competition an adapter built from a bare `baseUrl` states: the base's last path segment once its query and
 * fragment are cut, or `custom` when that is not a flat slug. The cut used to be one regular expression whose work
 * grew with the square of the input's length on a base holding many `#` before a line terminator (CodeQL
 * `js/polynomial-redos`). These cases pin what the cut answers on the shapes below, the odd inputs included. They are
 * examples, not a proof that two cuts agree on every string. Every case is green on the old expression too. A line
 * terminator, and every other invisible character, is written escaped: the old cut never crossed a terminator.
 */
const HOST = 'https://example.test/apis/site/v2/sports/soccer';
const competitionOf = (baseUrl: string): string => new EspnAdapter({ baseUrl }).competition;

describe('the competition of a bare base URL', () => {
  it.each([
    [`${HOST}/eng.1`, 'eng.1'],
    [`${HOST}/eng.1/`, 'eng.1'],
    [`${HOST}/esp.copa_del_rey`, 'esp.copa_del_rey'],
    [`${HOST}/uefa.champions`, 'uefa.champions'],
    [`${HOST}/${'a'.repeat(64)}`, 'a'.repeat(64)],
  ])('a flat slug is the competition: %s', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it.each([
    [`${HOST}/eng.1?dates=20261121`, 'eng.1'],
    [`${HOST}/eng.1#standings`, 'eng.1'],
    [`${HOST}/eng.1?a=1#b?c#d`, 'eng.1'],
    [`${HOST}/eng.1#b?c/d/e`, 'eng.1'],
    [`${HOST}/eng.1/?limit=1000`, 'eng.1'],
    [`${HOST}/eng.1?`, 'eng.1'],
    [`${HOST}/eng.1#`, 'eng.1'],
  ])('a query or a fragment is cut before the last segment is read: %s', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it.each([
    ['', 'custom'],
    ['?dates=20261121', 'custom'],
    ['#x', 'custom'],
    [`${HOST}/has space`, 'custom'],
    [`${HOST}/eng.1%2F`, 'custom'],
    [`${HOST}/${'a'.repeat(65)}`, 'custom'],
    [`${HOST}/eng.1/!`, 'custom'],
    // only `?` and `#` cut: another separator stays in the last segment
    [`${HOST}/eng.1&a=1`, 'custom'],
    [`${HOST}/eng.1;a`, 'custom'],
  ])('anything that is not a flat slug is custom: %j', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it.each([
    // the cut starts at the first `?` or `#` that no line terminator follows
    [`${HOST}/eng.1?a\nb`, 'custom'],
    [`${HOST}/eng.1?a\n`, 'custom'],
    [`${HOST}/eng.1?a\nb#c`, 'custom'],
    [`${HOST}/eng.1?a\u2028b`, 'custom'],
    [`${HOST}/eng.1#a\rb`, 'custom'],
    [`${HOST}/x?a\n/eng.1#c`, 'eng.1'],
    [`${HOST}/x?a\r/eng.1#c`, 'eng.1'],
    [`${HOST}/x#a\u2029/eng.1?c#d`, 'eng.1'],
    [`${HOST}/a\nb/eng.1?x`, 'eng.1'],
    [`${HOST}/a\nb/eng.1`, 'eng.1'],
  ])('a line terminator after a `?` or `#` keeps that one from cutting: %j', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it.each([
    // two terminators: the LAST one decides which `?` or `#` may cut
    [`${HOST}/x\n?a\n/eng.1`, 'eng.1'],
    [`${HOST}/x\n/eng.1?y\n/esp.1`, 'esp.1'],
    [`${HOST}/x\r?a\u2028/eng.1#z`, 'eng.1'],
    // each kind of terminator twice: the last of that kind decides
    [`${HOST}/x\r?a\r/eng.1`, 'eng.1'],
    [`${HOST}/x\u2028?a\u2028/eng.1`, 'eng.1'],
    [`${HOST}/x\u2029#a\u2029/eng.1`, 'eng.1'],
  ])('with two line terminators the last one decides: %j', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it.each([
    // not line terminators to `.`: NEL, a vertical tab, a form feed, a tab, a no-break space
    [`${HOST}/eng.1?a\u0085b`, 'eng.1'],
    [`${HOST}/eng.1?a\vb`, 'eng.1'],
    [`${HOST}/eng.1#a\fb`, 'eng.1'],
    [`${HOST}/eng.1?a\tb`, 'eng.1'],
    [`${HOST}/eng.1#a\u00a0b`, 'eng.1'],
  ])('a character that only looks like a line terminator does not stop the cut: %j', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it.each([
    // the cutting character is the first one searched, with a path after it
    ['?a/eng.1', 'custom'],
    ['#/eng.1', 'custom'],
    [`${HOST}/x\n#/eng.1`, 'custom'],
    [`${HOST}/x\u2029?/eng.1`, 'custom'],
  ])('a `?` or `#` at the very start of what is searched still cuts: %j', (base, want) => {
    expect(competitionOf(base)).toBe(want);
  });

  it('a base of many `#` before a line terminator is answered like any other', () => {
    expect(competitionOf(`${'#'.repeat(2000)}\n`)).toBe('custom');
    expect(competitionOf(`${HOST}/eng.1${'#'.repeat(2000)}\n`)).toBe('custom');
    expect(competitionOf(`${HOST}/x${'?#'.repeat(1000)}\n/eng.1#z`)).toBe('eng.1');
  });

  it('a stated competition wins over the base', () => {
    expect(new EspnAdapter({ baseUrl: `${HOST}/eng.1?x`, competition: 'esp.1' }).competition).toBe('esp.1');
  });
});
