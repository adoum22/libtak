import { describe, expect, it } from 'vitest';
import {
    buildDiscountPayload,
    type DiscountForm,
    validateDiscountForm,
} from '../utils/discountForm';

const validForm = (overrides: Partial<DiscountForm> = {}): DiscountForm => ({
    name: 'Rentrée scolaire',
    code: 'rentree10',
    discount_type: 'PERCENTAGE',
    value: '10',
    minimum_amount: '100',
    start_date: '2026-08-01',
    end_date: '2026-09-30',
    max_uses: '250',
    active: true,
    ...overrides,
});

describe('validation des remises', () => {
    it('refuse les valeurs financières invalides et un pourcentage supérieur à 100', () => {
        expect(validateDiscountForm(validForm({ value: '0' })).value).toMatch(/supérieure à 0/);
        expect(validateDiscountForm(validForm({ value: '100.01' })).value).toMatch(/100/);
        expect(validateDiscountForm(validForm({ minimum_amount: '-1' })).minimum_amount).toBeDefined();
    });

    it('refuse une période inversée et une limite non entière', () => {
        const errors = validateDiscountForm(validForm({
            start_date: '2026-10-01',
            end_date: '2026-09-30',
            max_uses: '2.5',
        }));

        expect(errors.end_date).toMatch(/postérieure ou égale/);
        expect(errors.max_uses).toMatch(/entier supérieur à 0/);
    });

    it('accepte une remise fixe sans dates ni limite et construit le contrat API attendu', () => {
        const form = validForm({
            name: '  Fidélité  ',
            code: ' fidelite5 ',
            discount_type: 'FIXED',
            value: '5,5',
            minimum_amount: '',
            start_date: '',
            end_date: '',
            max_uses: '',
            active: false,
        });

        expect(validateDiscountForm(form)).toEqual({});
        expect(buildDiscountPayload(form)).toEqual({
            name: 'Fidélité',
            code: 'FIDELITE5',
            discount_type: 'FIXED',
            value: '5.50',
            min_purchase: '0.00',
            start_date: null,
            end_date: null,
            max_uses: 0,
            active: false,
        });
    });
});
