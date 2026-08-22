import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import client from '../api/client';
import {
    currencyLocale,
    formatCurrencyAmount,
    normalizeCurrencySymbol,
} from '../utils/currency';

interface PublicCurrencySettings {
    currency?: string;
    currency_symbol?: string;
}

export default function useCurrency() {
    const { i18n } = useTranslation();
    const { data } = useQuery<PublicCurrencySettings>({
        queryKey: ['publicSettings'],
        queryFn: () => client.get('/auth/settings/public/').then(response => response.data),
        staleTime: 5 * 60_000,
    });
    const symbol = normalizeCurrencySymbol(data?.currency_symbol);
    const locale = currencyLocale(i18n.resolvedLanguage || i18n.language);

    return {
        code: data?.currency || 'MAD',
        symbol,
        format: (amount: number | string | null | undefined) => (
            formatCurrencyAmount(amount, symbol, locale)
        ),
    };
}
