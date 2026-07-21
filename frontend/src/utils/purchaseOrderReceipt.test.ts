import { describe, expect, it } from 'vitest';
import { buildReceiveOrderItem } from './purchaseOrderReceipt';

describe('buildReceiveOrderItem', () => {
    it('rend explicite le changement du prix de vente global', () => {
        expect(buildReceiveOrderItem({
            item_id: 7,
            quantity: '3',
            unit_cost: '12.00',
            update_purchase_price: true,
            new_sale_price: '25.00',
        })).toEqual({
            item_id: 7,
            quantity: 3,
            unit_cost: 12,
            update_purchase_price: true,
            new_sale_price: 25,
            update_sale_price: true,
        });
    });

    it('conserve le prix courant lorsque le nouveau prix est vide', () => {
        expect(buildReceiveOrderItem({
            item_id: 8,
            quantity: '2',
            unit_cost: '10.00',
            update_purchase_price: false,
            new_sale_price: '',
        })).toEqual({ item_id: 8, quantity: 2, unit_cost: 10 });
    });
});
