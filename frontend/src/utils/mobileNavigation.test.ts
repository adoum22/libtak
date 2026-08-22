import { describe, expect, it } from 'vitest';

import { getPrimaryMobilePaths, MOBILE_DIRECT_ITEM_LIMIT } from './mobileNavigation';

describe('mobile navigation', () => {
  it.each([true, false])('reserves the fifth slot for the More menu', (isAdmin) => {
    const directItems = getPrimaryMobilePaths(isAdmin);
    expect(directItems).toHaveLength(MOBILE_DIRECT_ITEM_LIMIT);
    expect(new Set(directItems).size).toBe(directItems.length);
  });
});
