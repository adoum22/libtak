import { parseDecimalInput } from './numberInput';

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface DiscountForm {
    name: string;
    code: string;
    discount_type: DiscountType;
    value: string;
    minimum_amount: string;
    start_date: string;
    end_date: string;
    max_uses: string;
    active: boolean;
}

export type DiscountFormErrors = Partial<Record<keyof DiscountForm, string>>;

export interface DiscountPayload {
    name: string;
    code: string;
    discount_type: DiscountType;
    value: string;
    min_purchase: string;
    start_date: string | null;
    end_date: string | null;
    max_uses: number;
    active: boolean;
}

export const validateDiscountForm = (form: DiscountForm): DiscountFormErrors => {
    const errors: DiscountFormErrors = {};
    const value = parseDecimalInput(form.value);
    const minimumAmount = form.minimum_amount.trim() === ''
        ? 0
        : parseDecimalInput(form.minimum_amount);

    if (!form.name.trim()) errors.name = 'Le nom de la remise est obligatoire.';
    if (!form.code.trim()) errors.code = 'Le code à saisir en caisse est obligatoire.';
    if (form.value.trim().startsWith('-') || !Number.isFinite(value) || value <= 0) {
        errors.value = 'La valeur doit être supérieure à 0.';
    } else if (form.discount_type === 'PERCENTAGE' && value > 100) {
        errors.value = 'Le pourcentage ne peut pas dépasser 100 %.';
    }
    if (form.minimum_amount.trim().startsWith('-') || !Number.isFinite(minimumAmount) || minimumAmount < 0) {
        errors.minimum_amount = 'Le montant minimum doit être positif ou nul.';
    }
    if (form.max_uses.trim()) {
        const maxUses = Number(form.max_uses);
        if (!/^\d+$/.test(form.max_uses) || !Number.isSafeInteger(maxUses) || maxUses <= 0) {
            errors.max_uses = 'Indiquez un nombre entier supérieur à 0, ou laissez vide.';
        }
    }
    if (form.start_date && form.end_date && form.start_date > form.end_date) {
        errors.end_date = 'La date de fin doit être postérieure ou égale à la date de début.';
    }
    return errors;
};

export const buildDiscountPayload = (form: DiscountForm): DiscountPayload => {
    const minimumAmount = form.minimum_amount.trim() === ''
        ? 0
        : parseDecimalInput(form.minimum_amount);
    return {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        discount_type: form.discount_type,
        value: parseDecimalInput(form.value).toFixed(2),
        min_purchase: minimumAmount.toFixed(2),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        max_uses: form.max_uses.trim() ? Number(form.max_uses) : 0,
        active: form.active,
    };
};
