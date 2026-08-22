export const currencyLocale = (language?: string) => {
    if (language?.startsWith('ar')) return 'ar-MA';
    if (language?.startsWith('en')) return 'en-GB';
    return 'fr-FR';
};

export const normalizeCurrencySymbol = (symbol?: unknown) => {
    const normalized = String(symbol ?? '').trim();
    return normalized || 'DH';
};

export const formatCurrencyAmount = (
    amount: number | string | null | undefined,
    symbol?: unknown,
    locale = 'fr-FR',
) => {
    const numeric = Number(amount ?? 0);
    const safeAmount = Number.isFinite(numeric) ? numeric : 0;
    return `${safeAmount.toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} ${normalizeCurrencySymbol(symbol)}`;
};
