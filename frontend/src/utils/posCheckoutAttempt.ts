import { POS_CHECKOUT_ATTEMPT_STORAGE_KEY } from './privateSessionStorage';

export interface POSCheckoutAttempt {
    fingerprint: string;
    key: string;
}

const isCheckoutAttempt = (value: unknown): value is POSCheckoutAttempt => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<POSCheckoutAttempt>;
    return typeof candidate.fingerprint === 'string'
        && candidate.fingerprint.length > 0
        && typeof candidate.key === 'string'
        && candidate.key.length >= 16;
};

export const loadCheckoutAttempt = (): POSCheckoutAttempt | null => {
    try {
        const raw = sessionStorage.getItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (isCheckoutAttempt(parsed)) return parsed;
    } catch {
        // Corrupt or legacy state is discarded below.
    }
    sessionStorage.removeItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY);
    return null;
};

export const persistCheckoutAttempt = (attempt: POSCheckoutAttempt) => {
    sessionStorage.setItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
};

export const clearCheckoutAttempt = () => {
    sessionStorage.removeItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY);
};

export const getOrCreateCheckoutAttempt = (
    fingerprint: string,
    current: POSCheckoutAttempt | null,
    createKey: () => string = () => crypto.randomUUID(),
): POSCheckoutAttempt => {
    if (current?.fingerprint === fingerprint) return current;
    return { fingerprint, key: createKey() };
};
