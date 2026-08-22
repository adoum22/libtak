export const POS_CART_STORAGE_KEY = 'libtak.posCart';
export const POS_HELD_CARTS_STORAGE_KEY = 'libtak.posHeldCarts';
export const POS_LAST_RECEIPT_STORAGE_KEY = 'libtak.posLastReceipt';
export const POS_CHECKOUT_ATTEMPT_STORAGE_KEY = 'libtak.posCheckoutAttempt';
export const CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY = 'libtak.creditPaymentAttempt';
export const CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY = 'libtak.creditReversalAttempt';
export const ACCOUNTING_OPERATION_ATTEMPT_PREFIX = 'libtak.accountingOperationAttempt.';
export const CASH_REGISTER_OPERATION_ATTEMPT_PREFIX = 'libtak.cashRegisterOperationAttempt.';
export const PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX = 'libtak.purchaseOrderOperationAttempt.';
export const RETURN_OPERATION_ATTEMPT_PREFIX = 'libtak.returnOperationAttempt.';

export const ACCOUNTING_CASHIER_EXPENSE_ATTEMPT_STORAGE_KEY = `${ACCOUNTING_OPERATION_ATTEMPT_PREFIX}cashier-expense`;
export const ACCOUNTING_WITHDRAWAL_ATTEMPT_STORAGE_KEY = `${ACCOUNTING_OPERATION_ATTEMPT_PREFIX}withdrawal`;
export const ACCOUNTING_EXPENSE_ATTEMPT_STORAGE_KEY = `${ACCOUNTING_OPERATION_ATTEMPT_PREFIX}expense`;
export const CASH_REGISTER_OPENING_ATTEMPT_STORAGE_KEY = `${CASH_REGISTER_OPERATION_ATTEMPT_PREFIX}opening`;
export const CASH_REGISTER_COUNT_ATTEMPT_STORAGE_KEY = `${CASH_REGISTER_OPERATION_ATTEMPT_PREFIX}count`;
export const PURCHASE_ORDER_RECEIPT_ATTEMPT_STORAGE_KEY = `${PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX}receipt`;
export const PURCHASE_ORDER_PAYMENT_ATTEMPT_STORAGE_KEY = `${PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX}payment`;
export const PURCHASE_ORDER_REVERSAL_ATTEMPT_STORAGE_KEY = `${PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX}reversal`;
export const RETURN_CREATION_ATTEMPT_STORAGE_KEY = `${RETURN_OPERATION_ATTEMPT_PREFIX}create`;

const PRIVATE_OPERATION_ATTEMPT_PREFIXES = [
    ACCOUNTING_OPERATION_ATTEMPT_PREFIX,
    CASH_REGISTER_OPERATION_ATTEMPT_PREFIX,
    PURCHASE_ORDER_OPERATION_ATTEMPT_PREFIX,
    RETURN_OPERATION_ATTEMPT_PREFIX,
] as const;

/**
 * Remove business data that must never survive a logout or an account switch.
 * Authentication tokens are handled separately by the API client.
 */
export const clearPrivateSessionStorage = () => {
    sessionStorage.removeItem(POS_CART_STORAGE_KEY);
    sessionStorage.removeItem(POS_HELD_CARTS_STORAGE_KEY);
    sessionStorage.removeItem(POS_LAST_RECEIPT_STORAGE_KEY);
    sessionStorage.removeItem(POS_CHECKOUT_ATTEMPT_STORAGE_KEY);
    sessionStorage.removeItem(CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY);
    sessionStorage.removeItem(CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY);
    Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
        .filter((key): key is string => Boolean(
            key && PRIVATE_OPERATION_ATTEMPT_PREFIXES.some(prefix => key.startsWith(prefix)),
        ))
        .forEach(key => sessionStorage.removeItem(key));
};
