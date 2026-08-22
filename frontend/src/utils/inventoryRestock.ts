export const getSuggestedRestock = (stock: number, minimumStock: number) => (
  Math.max(1, Math.max(0, minimumStock) * 2 - Math.max(0, stock))
);
