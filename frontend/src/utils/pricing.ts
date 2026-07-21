export function calculateLineTotal(
    currentSalePrice: number | string,
    quantity: number,
): number {
    const price = Number(currentSalePrice);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0) {
        return 0;
    }
    return price * quantity;
}
