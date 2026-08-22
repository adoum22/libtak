export interface OperationAttempt {
    fingerprint: string;
    key: string;
}

const OPERATION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

const isOperationAttempt = (value: unknown): value is OperationAttempt => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<OperationAttempt>;
    return typeof candidate.fingerprint === 'string'
        && candidate.fingerprint.length > 0
        && typeof candidate.key === 'string'
        && OPERATION_KEY_PATTERN.test(candidate.key);
};

export const loadOperationAttempt = (storageKey: string): OperationAttempt | null => {
    try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (isOperationAttempt(parsed)) return parsed;
    } catch {
        // Corrupt or legacy state is discarded below.
    }
    sessionStorage.removeItem(storageKey);
    return null;
};

export const persistOperationAttempt = (
    storageKey: string,
    attempt: OperationAttempt,
) => {
    sessionStorage.setItem(storageKey, JSON.stringify(attempt));
};

export const clearOperationAttempt = (storageKey: string) => {
    sessionStorage.removeItem(storageKey);
};

export const getOrCreateOperationAttempt = (
    fingerprint: string,
    current: OperationAttempt | null,
    createKey: () => string = () => globalThis.crypto.randomUUID(),
): OperationAttempt => {
    if (current?.fingerprint === fingerprint) return current;
    return { fingerprint, key: createKey() };
};

export const operationFingerprint = (parts: readonly unknown[]) => JSON.stringify(parts);
