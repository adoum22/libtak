import { describe, expect, it } from 'vitest';
import { canAccessStock } from '../utils/stockPermissions';

describe('canAccessStock', () => {
    it('autorise un administrateur et les vendeurs avec consultation ou gestion du stock', () => {
        expect(canAccessStock({ role: 'ADMIN' })).toBe(true);
        expect(canAccessStock({ role: 'CASHIER', can_view_stock: true })).toBe(true);
        expect(canAccessStock({ role: 'CASHIER', can_manage_stock: true })).toBe(true);
    });

    it('refuse un vendeur sans permission de stock', () => {
        expect(canAccessStock({ role: 'CASHIER', can_view_stock: false, can_manage_stock: false })).toBe(false);
        expect(canAccessStock(undefined)).toBe(false);
    });
});
