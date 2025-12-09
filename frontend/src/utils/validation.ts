// Form validation utilities

export interface ValidationRule {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    custom?: (value: string) => string | null;
}

export interface ValidationSchema {
    [field: string]: ValidationRule;
}

export interface ValidationErrors {
    [field: string]: string;
}

/**
 * Validate a single field value against rules
 */
export function validateField(value: string, rules: ValidationRule): string | null {
    if (rules.required && !value.trim()) {
        return 'Ce champ est obligatoire';
    }

    if (rules.minLength && value.length < rules.minLength) {
        return `Minimum ${rules.minLength} caractères`;
    }

    if (rules.maxLength && value.length > rules.maxLength) {
        return `Maximum ${rules.maxLength} caractères`;
    }

    if (rules.pattern && !rules.pattern.test(value)) {
        return 'Format invalide';
    }

    if (rules.custom) {
        return rules.custom(value);
    }

    return null;
}

/**
 * Validate an entire form against a schema
 */
export function validateForm(
    data: Record<string, string>,
    schema: ValidationSchema
): ValidationErrors {
    const errors: ValidationErrors = {};

    for (const [field, rules] of Object.entries(schema)) {
        const value = data[field] ?? '';
        const error = validateField(value, rules);
        if (error) {
            errors[field] = error;
        }
    }

    return errors;
}

/**
 * Check if form has any errors
 */
export function hasErrors(errors: ValidationErrors): boolean {
    return Object.keys(errors).length > 0;
}

// Common validation patterns
export const patterns = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /^[0-9+\-\s()]{8,20}$/,
    barcode: /^[A-Za-z0-9]{3,50}$/,
    price: /^\d+(\.\d{1,2})?$/,
    integer: /^\d+$/,
};

// Pre-built schemas
export const userSchema: ValidationSchema = {
    username: { required: true, minLength: 3, maxLength: 50 },
    email: { required: true, pattern: patterns.email },
    first_name: { required: true, minLength: 2 },
    last_name: { required: true, minLength: 2 },
};

export const productSchema: ValidationSchema = {
    name: { required: true, minLength: 2, maxLength: 200 },
    barcode: { required: true, pattern: patterns.barcode },
    sale_price_ht: { required: true, pattern: patterns.price },
    stock: { required: true, pattern: patterns.integer },
};

export const supplierSchema: ValidationSchema = {
    name: { required: true, minLength: 2, maxLength: 200 },
    email: { pattern: patterns.email },
    phone: { pattern: patterns.phone },
};
