import { describe, expect, it } from 'vitest';
import { ANNEX_C_ROWS } from '../src/bracket/third-place-data';
import { thirdPlaceGroupForWinner } from '../src/bracket/third-place';

describe('thirdPlaceGroupForWinner', () => {
  it('has 495 Annex C rows', () => {
    expect(ANNEX_C_ROWS).toHaveLength(495);
  });

  it('maps combination CDEFGIKL so 1E faces 3D', () => {
    expect(thirdPlaceGroupForWinner(['C', 'D', 'E', 'F', 'G', 'I', 'K', 'L'], 'E')).toBe('D');
  });

  it('returns undefined for an invalid combination size', () => {
    expect(thirdPlaceGroupForWinner(['A', 'B', 'C'], 'A')).toBeUndefined();
  });
});
