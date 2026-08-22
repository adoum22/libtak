import { describe, expect, it } from 'vitest';
import { getSuggestedRestock } from './inventoryRestock';

describe('getSuggestedRestock', () => {
  it('targets twice the minimum stock level', () => {
    expect(getSuggestedRestock(2, 5)).toBe(8);
    expect(getSuggestedRestock(0, 5)).toBe(10);
  });

  it('always suggests at least one unit for an alert row', () => {
    expect(getSuggestedRestock(10, 5)).toBe(1);
    expect(getSuggestedRestock(-2, -1)).toBe(1);
  });
});
