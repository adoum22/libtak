import { useTranslation } from 'react-i18next';

interface TooltipPayloadItem {
    color?: string;
    name?: string;
    value?: number | string;
}

interface PremiumChartTooltipProps {
    active?: boolean;
    payload?: TooltipPayloadItem[];
    label?: string | number;
    valueSuffix?: string;
}

const formatTooltipValue = (value: number | string | undefined, suffix: string, locale: string) => {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
        return `${numberValue.toLocaleString(locale, {
            maximumFractionDigits: 2,
        })}${suffix}`;
    }
    return `${value ?? '-'}${suffix}`;
};

export default function PremiumChartTooltip({
    active,
    payload,
    label,
    valueSuffix = '',
}: PremiumChartTooltipProps) {
    const { t, i18n } = useTranslation();
    if (!active || !payload?.length) return null;

    const locale = i18n.resolvedLanguage === 'ar'
        ? 'ar-MA'
        : i18n.resolvedLanguage === 'en'
            ? 'en-US'
            : 'fr-FR';

    return (
        <div className="chart-tooltip" role="status" aria-live="polite" aria-atomic="true">
            {label !== undefined && (
                <p className="chart-tooltip-title">{label}</p>
            )}
            <div className="chart-tooltip-list">
                {payload.map((item, index) => (
                    <div key={`${item.name ?? 'value'}-${index}`} className="chart-tooltip-row">
                        <span
                            className="chart-tooltip-dot"
                            style={{ backgroundColor: item.color || 'var(--color-accent)' }}
                            aria-hidden="true"
                        />
                        <span className="chart-tooltip-name">{item.name || t('Value')}</span>
                        <span className="chart-tooltip-value">
                            {formatTooltipValue(item.value, valueSuffix, locale)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
