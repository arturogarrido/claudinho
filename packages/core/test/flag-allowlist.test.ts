/**
 * Guard: the sanitizer's TAG-sequence allowlist must cover every subdivision
 * flag this product can actually emit.
 *
 * Why an allowlist and not a grammar. TAG characters (U+E0020..U+E007F) map
 * one-to-one onto printable ASCII, and a grapheme cluster has no length limit,
 * so a cluster carrying them is a covert instruction channel that costs 2
 * display columns. A shape check ("🏴 + 2-6 letters + cancel") bounds ONE
 * cluster but not the alphabet — and clusters CHAIN: eight legal-shaped ones
 * cost 16 columns and decode to a full sentence. Only an allowlist bounds it.
 *
 * The risk an allowlist creates is drift: add `['Northern Ireland', 'GB-NIR']`
 * to the flags table and that flag silently stops rendering. So this test reads
 * the flags source, builds every subdivision flag it can produce, and asserts
 * each survives sanitizing intact.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allTeams, flagEmoji, sanitizeFeedText } from '../src/index';

/** Every hyphenated region code the flags table knows about. */
function subdivisionRegions(): string[] {
  const src = readFileSync(join(__dirname, '..', 'src', 'flags.ts'), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/'([A-Za-z]{2}-[A-Za-z]{2,3})'/g)) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

describe('TAG-sequence allowlist covers every flag the product can emit', () => {
  it('finds the subdivision flags in the flags table (guard is wired up)', () => {
    // If this ever hits zero the regex above has drifted and the rest of this
    // file would vacuously pass.
    expect(subdivisionRegions().length).toBeGreaterThan(0);
  });

  it('every subdivision flag survives sanitizing byte-identical', () => {
    for (const region of subdivisionRegions()) {
      const flag = flagEmoji(region);
      expect(
        sanitizeFeedText(flag),
        `${region} renders a flag the sanitizer strips — add its exact sequence to ALLOWED_TAG_SEQUENCES in sanitize.ts`,
      ).toBe(flag);
    }
  });

  it('every flag on the shipped roster survives sanitizing byte-identical', () => {
    for (const t of allTeams()) {
      expect(sanitizeFeedText(t.flag), `${t.code} flag altered`).toBe(t.flag);
    }
  });

  it('a legal-SHAPED tag sequence outside the allowlist is still refused', () => {
    // The regression this file exists for: 'gbxxx' has the exact shape of a real
    // subdivision flag, so a grammar accepts it; the allowlist does not.
    const fake = flagEmoji('GB-XXX');
    expect(sanitizeFeedText(fake)).toBe('');
  });
});
