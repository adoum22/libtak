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

const formatTooltipValue = (value: number | string | undefined, suffix: string) => {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
        return `${numberValue.toLocaleString('fr-FR', {
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
    if (!active || !payload?.length) return null;

    return (
        <div className="chart-tooltip">
            {label !== undefined && (
                <p className="chart-tooltip-title">{label}</p>
            )}
            <div className="chart-tooltip-list">
                {payload.map((item, index) => (
                    <div key={`${item.name ?? 'value'}-${index}`} className="chart-tooltip-row">
                        <span
                            className="chart-tooltip-dot"
                            style={{ backgroundColor: item.color || 'var(--color-accent)' }}
                        />
                        <span className="chart-tooltip-name">{item.name || 'Valeur'}</span>
                        <span className="chart-tooltip-value">
                            {formatTooltipValue(item.value, valueSuffix)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
