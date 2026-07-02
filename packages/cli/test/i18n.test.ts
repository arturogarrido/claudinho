import { describe, expect, it } from 'vitest';
import { makeT } from '../src/i18n';

describe('makeT interpolation', () => {
  it('fills EVERY occurrence of a repeated placeholder (replaceAll semantics)', () => {
    // No catalog key repeats a placeholder yet, so exercise the fallback path
    // (unknown key → the key itself is the template) — same interpolation code.
    expect(makeT('en')('{team} vs {team}', { team: 'MEX' })).toBe('MEX vs MEX');
  });

  it('falls back to the EN catalog for a locale-missing key', () => {
    expect(makeT('es')('next.label', { team: 'MEX' })).toBe('Próximo partido de MEX');
    expect(makeT('zz' as string)('next.label', { team: 'MEX' })).toBe('Next up for MEX');
  });
});
