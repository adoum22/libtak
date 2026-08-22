import { beforeEach, describe, expect, it } from 'vitest';

import {
  CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY,
  CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY,
  ACCOUNTING_OPERATION_ATTEMPT_PREFIX,
  CASH_REGISTER_OPERATION_ATTEMPT_PREFIX,
  PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX,
  RETURN_OPERATION_ATTEMPT_PREFIX,
  clearPrivateSessionStorage,
  POS_CART_STORAGE_KEY,
  POS_CHECKOUT_ATTEMPT_STORAGE_KEY,
  POS_HELD_CARTS_STORAGE_KEY,
  POS_LAST_RECEIPT_STORAGE_KEY,
} from './privateSessionStorage';

describe('clearPrivateSessionStorage', () => {
  beforeEach(() => sessionStorage.clear());

  it('removes every POS draft and receipt while preserving unrelated preferences', () => {
    sessionStorage.setItem(POS_CART_STORAGE_KEY, '[{"private":true}]');
    sessionStorage.setItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY, '{"private":true}');
    sessionStorage.setItem(POS_HELD_CARTS_STORAGE_KEY, '[{"private":true}]');
    sessionStorage.setItem(POS_LAST_RECEIPT_STORAGE_KEY, '{"private":true}');
    sessionStorage.setItem(CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY, '{"private":true}');
    sessionStorage.setItem(CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY, '{"private":true}');
    sessionStorage.setItem(`${ACCOUNTING_OPERATION_ATTEMPT_PREFIX}expense`, '{"private":true}');
    sessionStorage.setItem(`${CASH_REGISTER_OPERATION_ATTEMPT_PREFIX}count`, '{"private":true}');
    sessionStorage.setItem(`${PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX}receipt.42`, '{"private":true}');
    sessionStorage.setItem(`${RETURN_OPERATION_ATTEMPT_PREFIX}create`, '{"private":true}');
    sessionStorage.setItem('language-preference', 'fr');

    clearPrivateSessionStorage();

    expect(sessionStorage.getItem(POS_CART_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(POS_HELD_CARTS_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(POS_LAST_RECEIPT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(`${ACCOUNTING_OPERATION_ATTEMPT_PREFIX}expense`)).toBeNull();
    expect(sessionStorage.getItem(`${CASH_REGISTER_OPERATION_ATTEMPT_PREFIX}count`)).toBeNull();
    expect(sessionStorage.getItem(`${PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX}receipt.42`)).toBeNull();
    expect(sessionStorage.getItem(`${RETURN_OPERATION_ATTEMPT_PREFIX}create`)).toBeNull();
    expect(sessionStorage.getItem('language-preference')).toBe('fr');
  });
});
