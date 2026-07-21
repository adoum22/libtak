import { parseDecimalInput } from './numberInput';

export type ReceiveOrderItem = {
    item_id: number;
    quantity: number;
    unit_cost?: number;
    update_purchase_price?: boolean;
    new_sale_price?: number;
    update_sale_price?: boolean;
};

export type ReceiveDraftInput = {
    item_id: number;
    quantity: string;
    unit_cost: string;
    update_purchase_price: boolean;
    new_sale_price: string;
};

export function buildReceiveOrderItem(
    draft: ReceiveDraftInput,
): ReceiveOrderItem | null {
    const quantity = Number(draft.quantity) || 0;
    if (quantity <= 0) return null;

    const payload: ReceiveOrderItem = {
        item_id: draft.item_id,
        quantity,
    };
    const cost = parseDecimalInput(draft.unit_cost);
    if (Number.isFinite(cost) && cost > 0) payload.unit_cost = cost;
    if (draft.update_purchase_price) payload.update_purchase_price = true;

    const newSalePrice = parseDecimalInput(draft.new_sale_price);
    if (Number.isFinite(newSalePrice) && newSalePrice > 0) {
        payload.new_sale_price = newSalePrice;
        payload.update_sale_price = true;
    }
    return payload;
}
