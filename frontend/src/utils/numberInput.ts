export const normalizeDecimalInput = (value: string) => {
    const withPoint = value.replace(/,/g, '.');
    const cleaned = withPoint.replace(/[^\d.]/g, '');
    const firstPoint = cleaned.indexOf('.');
    if (firstPoint === -1) return cleaned;
    return (
        cleaned.slice(0, firstPoint + 1)
        + cleaned.slice(firstPoint + 1).replace(/\./g, '')
    );
};

export const parseDecimalInput = (value: string) => (
    Number.parseFloat(normalizeDecimalInput(value))
);
