import { useState, useCallback } from 'react';
import { validateForm, hasErrors, type ValidationSchema, type ValidationErrors } from '../utils/validation';

/**
 * Custom hook for form validation
 */
export function useFormValidation<T extends Record<string, string>>(
    initialData: T,
    schema: ValidationSchema
) {
    const [data, setData] = useState<T>(initialData);
    const [errors, setErrors] = useState<ValidationErrors>({});
    const [touched, setTouched] = useState<Record<string, boolean>>({});

    const handleChange = useCallback((field: keyof T, value: string) => {
        setData(prev => ({ ...prev, [field]: value }));

        // Clear error when user starts typing
        if (errors[field as string]) {
            setErrors(prev => {
                const next = { ...prev };
                delete next[field as string];
                return next;
            });
        }
    }, [errors]);

    const handleBlur = useCallback((field: keyof T) => {
        setTouched(prev => ({ ...prev, [field]: true }));

        // Validate single field on blur
        const fieldErrors = validateForm({ [field]: data[field] } as Record<string, string>, {
            [field]: schema[field as string]
        });

        if (fieldErrors[field as string]) {
            setErrors(prev => ({ ...prev, ...fieldErrors }));
        }
    }, [data, schema]);

    const validate = useCallback(() => {
        const allErrors = validateForm(data as Record<string, string>, schema);
        setErrors(allErrors);
        setTouched(
            Object.keys(schema).reduce((acc, key) => ({ ...acc, [key]: true }), {})
        );
        return !hasErrors(allErrors);
    }, [data, schema]);

    const reset = useCallback(() => {
        setData(initialData);
        setErrors({});
        setTouched({});
    }, [initialData]);

    const getFieldProps = useCallback((field: keyof T) => ({
        value: data[field],
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
            handleChange(field, e.target.value),
        onBlur: () => handleBlur(field),
        className: errors[field as string] && touched[field as string] ? 'input-error' : '',
    }), [data, errors, touched, handleChange, handleBlur]);

    return {
        data,
        setData,
        errors,
        touched,
        handleChange,
        handleBlur,
        validate,
        reset,
        getFieldProps,
        isValid: !hasErrors(errors),
    };
}
