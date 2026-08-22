import { describe, expect, it } from 'vitest';

import { currencyLocale, formatCurrencyAmount, normalizeCurrencySymbol } from './currency';

describe('currency formatting', () => {
  it('uses the configured symbol and a stable two-decimal amount', () => {
    expect(formatCurrencyAmount(12.5, 'EUR', 'en-GB')).toBe('12.50 EUR');
  });

  it('falls back safely for empty symbols and non-finite values', () => {
    expect(normalizeCurrencySymbol('  ')).toBe('DH');
    expect(formatCurrencyAmount(Number.NaN, '', 'en-GB')).toBe('0.00 DH');
  });

  it('formats string amounts with the configured symbol and language locale', () => {
    expect(formatCurrencyAmount('1234.5', '€', 'fr-FR')).toBe('1 234,50 €');
    expect(currencyLocale('ar')).toBe('ar-MA');
    expect(currencyLocale('en-US')).toBe('en-GB');
  });
});
