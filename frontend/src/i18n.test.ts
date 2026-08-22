import { describe, expect, it } from 'vitest';

import i18n from './i18n';

const criticalKeys = [
  'Dashboard',
  'CashRegister',
  'Accounting',
  'Reports',
  'Stock',
  'Sales',
  'Credit',
  'Discounts',
  'PurchaseOrders',
  'Suppliers',
  'Returns',
  'CreditPaymentsIn',
  'CreditSaleRefundNotice',
  'ReturnValue',
  'CashRefundAmount',
  'StockCount',
  'Zakat',
  'Users',
  'Activity',
  'Settings',
  'Logout',
  'OpenMenu',
  'CloseMenu',
  'More',
  'LoginSubtitle',
  'SaleMode',
  'PriceCheck',
] as const;

describe('critical translations', () => {
  it.each(['fr', 'en', 'ar'])('defines the complete application shell in %s', (language) => {
    for (const key of criticalKeys) {
      expect(i18n.exists(key, { lng: language }), `${language}.${key}`).toBe(true);
      expect(i18n.t(key, { lng: language }).trim()).not.toBe('');
    }
  });

  it('keeps every translation key aligned and non-empty in French, English, and Arabic', () => {
    const languages = ['fr', 'en', 'ar'] as const;
    const expectedKeys = Object.keys(i18n.getResourceBundle('en', 'translation')).sort();

    for (const language of languages) {
      const bundle = i18n.getResourceBundle(language, 'translation') as Record<string, unknown>;
      expect(Object.keys(bundle).sort(), `${language} translation keys`).toEqual(expectedKeys);
      for (const key of expectedKeys) {
        expect(String(bundle[key] ?? '').trim(), `${language}.${key}`).not.toBe('');
      }
    }
  });

  it.each(['fr', 'en', 'ar'])('interpolates the configured currency in %s', (language) => {
    const symbol = '€';
    const formattedAmount = '12.50 €';

    expect(i18n.t('PurchasePriceCurrency', { lng: language, symbol })).toContain(symbol);
    expect(i18n.t('MinimumCartAmount', { lng: language, symbol })).toContain(symbol);
    expect(i18n.t('GrossRevenue', { lng: language, amount: formattedAmount })).toContain(formattedAmount);
    expect(i18n.t('BatchSummary', {
      lng: language,
      index: 1,
      remaining: 2,
      initial: 3,
      cost: formattedAmount,
    })).toContain(formattedAmount);
  });
});
