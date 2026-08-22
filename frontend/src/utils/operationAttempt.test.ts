import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearOperationAttempt,
    getOrCreateOperationAttempt,
    loadOperationAttempt,
    operationFingerprint,
    persistOperationAttempt,
} from './operationAttempt';

const STORAGE_KEY = 'test.operation-attempt';

describe('operation attempt persistence', () => {
    beforeEach(() => sessionStorage.clear());

    it('reuses the key for an identical financial operation after reload', () => {
        const fingerprint = operationFingerprint([42, '20.00', 'deposit']);
        const first = getOrCreateOperationAttempt(
            fingerprint,
            null,
            () => 'payment-operation-0001',
        );
        persistOperationAttempt(STORAGE_KEY, first);

        const replay = getOrCreateOperationAttempt(
            fingerprint,
            loadOperationAttempt(STORAGE_KEY),
            () => 'payment-operation-0002',
        );

        expect(replay.key).toBe('payment-operation-0001');
    });

    it('changes key when the payload changes', () => {
        const previous = {
            fingerprint: operationFingerprint([42, '20.00', 'deposit']),
            key: 'payment-operation-0001',
        };
        const next = getOrCreateOperationAttempt(
            operationFingerprint([42, '25.00', 'deposit']),
            previous,
            () => 'payment-operation-0002',
        );

        expect(next.key).toBe('payment-operation-0002');
    });

    it('clears completed attempts and rejects malformed keys', () => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            fingerprint: 'payload',
            key: 'contains spaces',
        }));
        expect(loadOperationAttempt(STORAGE_KEY)).toBeNull();

        persistOperationAttempt(STORAGE_KEY, {
            fingerprint: 'payload',
            key: 'payment-operation-0001',
        });
        clearOperationAttempt(STORAGE_KEY);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
