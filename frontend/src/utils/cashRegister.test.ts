import { describe, expect, it } from 'vitest';
import { calculateDenominationTotal } from './cashRegister';

describe('calculateDenominationTotal', () => {
  it('adds bills and coins without floating-point residue', () => {
    expect(calculateDenominationTotal({ 200: '2', 20: '3', 0.5: '2', 0.2: '1' })).toBeCloseTo(461.2, 2);
  });

  it('ignores blank, invalid and negative quantities', () => {
    expect(calculateDenominationTotal({ 100: '', 20: 'abc', 10: '-2', 5: '3' })).toBe(15);
  });
});
