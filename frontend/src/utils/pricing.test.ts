import { describe, expect, it } from 'vitest';
import { calculateLineTotal } from './pricing';

describe('calculateLineTotal', () => {
    it('applique le prix courant unique a toute la quantite', () => {
        expect(calculateLineTotal(25, 7)).toBe(175);
        expect(calculateLineTotal('18.00', 4)).toBe(72);
    });

    it('refuse les valeurs non vendables', () => {
        expect(calculateLineTotal('invalide', 2)).toBe(0);
        expect(calculateLineTotal(20, 0)).toBe(0);
    });
});
