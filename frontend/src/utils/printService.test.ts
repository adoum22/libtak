import { describe, expect, it } from 'vitest';

import { generateReceiptHTML } from './printService';

describe('receipt generation', () => {
  it('escapes user-configurable content and rejects unsafe logo protocols', () => {
    const html = generateReceiptHTML({
      saleId: 42,
      items: [{
        product: { name: '<script>alert(1)</script>', barcode: '123', price_ttc: 10 },
        quantity: 1,
      }],
      subtotal: 10,
      total: 10,
      paymentMethod: '<img src=x onerror=alert(1)>',
    }, {
      storeName: '<b>unsafe</b>',
      logoUrl: 'javascript:alert(1)',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;b&gt;unsafe&lt;/b&gt;');
  });

  it('uses authoritative per-line prices when FIFO layers changed the price', () => {
    const html = generateReceiptHTML({
      saleId: 7,
      items: [{
        product: { name: 'Livre', barcode: '123', price_ttc: 99 },
        quantity: 2,
        unitPrice: 12.5,
        lineTotal: 25,
      }],
      subtotal: 25,
      total: 25,
      paymentMethod: 'CARD',
    });

    expect(html).toContain('2 x 12.50 DH');
    expect(html).toContain('25.00 DH');
    expect(html).not.toContain('99.00 DH');
  });
});
