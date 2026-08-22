import { beforeEach, describe, expect, it } from 'vitest';

import { POS_CHECKOUT_ATTEMPT_STORAGE_KEY } from './privateSessionStorage';
import {
  clearCheckoutAttempt,
  getOrCreateCheckoutAttempt,
  loadCheckoutAttempt,
  persistCheckoutAttempt,
} from './posCheckoutAttempt';

describe('POS checkout attempt persistence', () => {
  beforeEach(() => sessionStorage.clear());

  it('reuses the same operation key after a reload for the same sale payload', () => {
    const first = getOrCreateCheckoutAttempt('same-sale', null, () => 'operation-key-0001');
    persistCheckoutAttempt(first);

    const restored = loadCheckoutAttempt();
    const replay = getOrCreateCheckoutAttempt('same-sale', restored, () => 'operation-key-0002');

    expect(replay.key).toBe('operation-key-0001');
  });

  it('creates a new key when the payload changes and clears it after success', () => {
    const previous = { fingerprint: 'old-sale', key: 'operation-key-0001' };
    const next = getOrCreateCheckoutAttempt('new-sale', previous, () => 'operation-key-0002');
    persistCheckoutAttempt(next);

    expect(next.key).toBe('operation-key-0002');
    clearCheckoutAttempt();
    expect(sessionStorage.getItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it('rejects malformed persisted state', () => {
    sessionStorage.setItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY, '{"key":true}');
    expect(loadCheckoutAttempt()).toBeNull();
  });
});
