export const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1] as const;

export const calculateDenominationTotal = (counts: Record<string, string | number>) => (
  CASH_DENOMINATIONS.reduce((total, denomination) => {
    const quantity = Number.parseInt(String(counts[String(denomination)] || '0'), 10);
    return total + denomination * (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0)
);
