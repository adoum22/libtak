import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    BadgePercent,
    CalendarDays,
    Edit3,
    Plus,
    Power,
    PowerOff,
    Save,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import { useToast } from '../components/ToastContext';
import {
    buildDiscountPayload,
    type DiscountForm,
    type DiscountFormErrors,
    type DiscountPayload,
    type DiscountType,
    validateDiscountForm,
} from '../utils/discountForm';
import { normalizeDecimalInput } from '../utils/numberInput';
import useCurrency from '../hooks/useCurrency';

interface Discount {
    id: number;
    name: string;
    code: string | null;
    discount_type: DiscountType;
    discount_type_display: string;
    value: string;
    min_purchase: string;
    max_uses: number;
    uses_count: number;
    active: boolean;
    start_date: string | null;
    end_date: string | null;
    is_valid: boolean;
    created_at: string;
}

interface DiscountsPage {
    count: number;
    results: Discount[];
}

const PAGE_SIZE = 50;

const EMPTY_FORM: DiscountForm = {
    name: '',
    code: '',
    discount_type: 'PERCENTAGE',
    value: '',
    minimum_amount: '0',
    start_date: '',
    end_date: '',
    max_uses: '',
    active: true,
};

const toForm = (discount: Discount): DiscountForm => ({
    name: discount.name,
    code: discount.code ?? '',
    discount_type: discount.discount_type,
    value: String(discount.value),
    minimum_amount: String(discount.min_purchase),
    start_date: discount.start_date ?? '',
    end_date: discount.end_date ?? '',
    max_uses: discount.max_uses > 0 ? String(discount.max_uses) : '',
    active: discount.active,
});

const localDateIso = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getStatus = (discount: Discount, translate: (key: string) => string) => {
    const today = localDateIso();
    if (!discount.active) return { label: translate('Inactive'), badge: 'badge-secondary' };
    if (discount.max_uses > 0 && discount.uses_count >= discount.max_uses) {
        return { label: translate('Exhausted'), badge: 'badge-warning' };
    }
    if (discount.start_date && discount.start_date > today) {
        return { label: translate('Scheduled'), badge: 'badge-info' };
    }
    if (discount.end_date && discount.end_date < today) {
        return { label: translate('Expired'), badge: 'badge-danger' };
    }
    if (discount.is_valid) return { label: translate('Active'), badge: 'badge-success' };
    return { label: translate('Unavailable'), badge: 'badge-warning' };
};

const formatAmount = (value: string | number, locale: string) => new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(Number(value));

const formatDate = (value: string | null, locale: string, withoutLimit: string) => (
    value
        ? new Date(`${value}T00:00:00`).toLocaleDateString(locale)
        : withoutLimit
);

export default function Discounts() {
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
    const queryClient = useQueryClient();
    const toast = useToast();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);
    const [discountToDelete, setDiscountToDelete] = useState<Discount | null>(null);
    const [form, setForm] = useState<DiscountForm>(EMPTY_FORM);
    const [formErrors, setFormErrors] = useState<DiscountFormErrors>({});

    const { data, isLoading, isError, refetch } = useQuery<DiscountsPage>({
        queryKey: ['discounts', search, page],
        queryFn: () => client.get('/sales/discounts/', {
            params: {
                search: search.trim() || undefined,
                page,
            },
        }).then((response) => ({
            count: Number(response.data?.count ?? (Array.isArray(response.data) ? response.data.length : 0)),
            results: response.data?.results ?? (Array.isArray(response.data) ? response.data : []),
        })),
        placeholderData: previous => previous,
    });

    const discounts = data?.results ?? [];
    const totalItems = data?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    const closeModal = () => {
        if (createMutation.isPending || updateMutation.isPending) return;
        setIsModalOpen(false);
        setEditingDiscount(null);
        setForm(EMPTY_FORM);
        setFormErrors({});
    };

    const createMutation = useMutation({
        mutationFn: (payload: DiscountPayload) => client.post('/sales/discounts/', payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['discounts'] });
            setIsModalOpen(false);
            setEditingDiscount(null);
            setForm(EMPTY_FORM);
            setFormErrors({});
            toast.success(t('DiscountCreated'));
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('DiscountCreateFailed')));
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: DiscountPayload }) => (
            client.patch(`/sales/discounts/${id}/`, payload)
        ),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['discounts'] });
            setIsModalOpen(false);
            setEditingDiscount(null);
            setForm(EMPTY_FORM);
            setFormErrors({});
            toast.success(t('DiscountUpdated'));
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('DiscountUpdateFailed')));
        },
    });

    const toggleMutation = useMutation({
        mutationFn: ({ id, active }: { id: number; active: boolean }) => (
            client.patch(`/sales/discounts/${id}/`, { active })
        ),
        onSuccess: (_response, variables) => {
            void queryClient.invalidateQueries({ queryKey: ['discounts'] });
            toast.success(variables.active ? t('DiscountEnabled') : t('DiscountDisabled'));
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('DiscountStatusFailed')));
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => client.delete(`/sales/discounts/${id}/`),
        onSuccess: () => {
            if (discounts.length === 1 && page > 1) setPage(current => current - 1);
            void queryClient.invalidateQueries({ queryKey: ['discounts'] });
            setDiscountToDelete(null);
            toast.success(t('DiscountDeleted'));
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('DiscountDeleteFailed')));
        },
    });

    const isSaving = createMutation.isPending || updateMutation.isPending;

    useEffect(() => {
        if (!isModalOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSaving) closeModal();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    });

    const openCreateModal = () => {
        setEditingDiscount(null);
        setForm(EMPTY_FORM);
        setFormErrors({});
        setIsModalOpen(true);
    };

    const openEditModal = (discount: Discount) => {
        setEditingDiscount(discount);
        setForm(toForm(discount));
        setFormErrors({});
        setIsModalOpen(true);
    };

    const updateField = <K extends keyof DiscountForm>(field: K, value: DiscountForm[K]) => {
        setForm(current => ({ ...current, [field]: value }));
        setFormErrors(current => {
            if (!current[field]) return current;
            const next = { ...current };
            delete next[field];
            return next;
        });
    };

    const submitForm = (event: React.FormEvent) => {
        event.preventDefault();
        const errors = validateDiscountForm(form, key => t(key));
        if (Object.keys(errors).length > 0) {
            setFormErrors(errors);
            toast.error(t('CheckHighlightedFields'));
            return;
        }
        const payload = buildDiscountPayload(form);
        if (editingDiscount) {
            updateMutation.mutate({ id: editingDiscount.id, payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <BadgePercent className="text-accent" size={30} aria-hidden="true" />
                        <h1 className="text-3xl font-bold text-primary">{t('Discounts')}</h1>
                    </div>
                    <p className="text-muted">
                        {t('DiscountsSubtitle')}
                    </p>
                </div>
                <button type="button" className="btn-primary" onClick={openCreateModal}>
                    <Plus size={19} aria-hidden="true" />
                    {t('NewDiscount')}
                </button>
            </div>

            <div className="card p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="relative flex-1" style={{ minWidth: 'min(100%, 18rem)', maxWidth: '36rem' }}>
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} aria-hidden="true" />
                        <input
                            type="search"
                            className="input-icon-left"
                            value={search}
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            placeholder={t('SearchDiscountPlaceholder')}
                            aria-label={t('SearchDiscount')}
                        />
                    </div>
                    <p className="text-sm text-muted" aria-live="polite">
                        {isError ? t('ListUnavailable') : t('DiscountsCount', { count: totalItems })}
                    </p>
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table>
                        <caption className="sr-only">{t('DiscountCodesCaption')}</caption>
                        <thead>
                            <tr>
                                <th scope="col">{t('Discount')}</th>
                                <th scope="col">{t('Value')}</th>
                                <th scope="col">{t('Conditions')}</th>
                                <th scope="col">{t('Uses')}</th>
                                <th scope="col">{t('Status')}</th>
                                <th scope="col" className="text-right">{t('Actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-8 text-muted">
                                        <span className="spinner" aria-hidden="true" />
                                        <span className="sr-only">{t('DiscountsLoading')}</span>
                                    </td>
                                </tr>
                            ) : isError ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-8">
                                        <div className="network-error-state" role="alert">
                                            <p>{t('DiscountsLoadFailed')}</p>
                                            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
                                                {t('Retry')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ) : discounts.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-8">
                                        <BadgePercent size={36} className="text-muted mx-auto mb-2" aria-hidden="true" />
                                        <p className="font-medium">{t('NoDiscounts')}</p>
                                        <p className="text-sm text-muted mt-1">
                                            {search ? t('TryAnotherSearch') : t('CreateFirstDiscount')}
                                        </p>
                                    </td>
                                </tr>
                            ) : discounts.map((discount) => {
                                const status = getStatus(discount, key => t(key));
                                const toggling = toggleMutation.isPending && toggleMutation.variables?.id === discount.id;
                                return (
                                    <tr key={discount.id}>
                                        <td>
                                            <p className="font-semibold text-primary">{discount.name}</p>
                                            <span className="badge badge-accent font-mono mt-1">
                                                {discount.code || t('NoCode')}
                                            </span>
                                        </td>
                                        <td>
                                            <p className="font-bold text-accent">
                                                {discount.discount_type === 'PERCENTAGE'
                                                    ? `${formatAmount(discount.value, i18n.language)} %`
                                                    : currency.format(discount.value)}
                                            </p>
                                            <p className="text-xs text-muted">
                                                {discount.discount_type === 'PERCENTAGE' ? t('Percentage') : t('FixedAmount')}
                                            </p>
                                        </td>
                                        <td>
                                            <p className="text-sm">
                                                {t('Minimum', { amount: currency.format(discount.min_purchase) })}
                                            </p>
                                            <p className="text-xs text-muted mt-1 flex items-center gap-1">
                                                <CalendarDays size={14} aria-hidden="true" />
                                                {formatDate(discount.start_date, i18n.language, t('WithoutLimit'))} — {formatDate(discount.end_date, i18n.language, t('WithoutLimit'))}
                                            </p>
                                        </td>
                                        <td>
                                            <span className="font-medium">{discount.uses_count}</span>
                                            <span className="text-muted">
                                                {discount.max_uses > 0 ? ` / ${discount.max_uses}` : ` / ${t('Unlimited')}`}
                                            </span>
                                        </td>
                                        <td><span className={`badge ${status.badge}`}>{status.label}</span></td>
                                        <td>
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    type="button"
                                                    className="btn-ghost btn-icon"
                                                    onClick={() => toggleMutation.mutate({ id: discount.id, active: !discount.active })}
                                                    disabled={toggling}
                                                    aria-label={t(discount.active ? 'DisableNamed' : 'EnableNamed', { name: discount.name })}
                                                    title={t(discount.active ? 'Disable' : 'Enable')}
                                                >
                                                    {discount.active ? <PowerOff size={18} /> : <Power size={18} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-ghost btn-icon"
                                                    onClick={() => openEditModal(discount)}
                                                    aria-label={t('EditNamed', { name: discount.name })}
                                                    title={t('Edit')}
                                                >
                                                    <Edit3 size={18} />
                                                </button>
                                                {discount.uses_count === 0 && (
                                                    <button
                                                        type="button"
                                                        className="btn-ghost btn-icon text-danger"
                                                        onClick={() => setDiscountToDelete(discount)}
                                                        aria-label={t('DeleteNamed', { name: discount.name })}
                                                        title={t('Delete')}
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {!isLoading && !isError && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        totalItems={totalItems}
                        pageSize={PAGE_SIZE}
                        onPageChange={setPage}
                    />
                )}
            </div>

            {isModalOpen && (
                <div
                    className="modal-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.currentTarget === event.target && !isSaving) closeModal();
                    }}
                >
                    <div
                        className="modal max-w-3xl"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="discount-modal-title"
                        aria-describedby="discount-modal-description"
                    >
                        <div className="modal-header">
                            <div>
                                <h2 id="discount-modal-title" className="text-xl font-bold">
                                    {editingDiscount ? t('EditDiscount') : t('NewDiscount')}
                                </h2>
                                <p id="discount-modal-description" className="text-sm text-muted mt-1">
                                    {t('RequiredFieldsHint')}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn-ghost btn-icon"
                                onClick={closeModal}
                                disabled={isSaving}
                                aria-label={t('Close')}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={submitForm} noValidate>
                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="form-group">
                                        <label htmlFor="discount-name" className="label">{t('Name')} *</label>
                                        <input
                                            id="discount-name"
                                            autoFocus
                                            maxLength={100}
                                            value={form.name}
                                            onChange={(event) => updateField('name', event.target.value)}
                                            placeholder={t('DiscountNameExample')}
                                            aria-invalid={Boolean(formErrors.name)}
                                            aria-describedby={formErrors.name ? 'discount-name-error' : undefined}
                                        />
                                        {formErrors.name && <p id="discount-name-error" className="text-sm text-danger">{formErrors.name}</p>}
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-code" className="label">{t('CheckoutCode')} *</label>
                                        <input
                                            id="discount-code"
                                            maxLength={50}
                                            className="font-mono"
                                            value={form.code}
                                            onChange={(event) => updateField('code', event.target.value.toUpperCase().replace(/\s/g, ''))}
                                            placeholder={t('DiscountCodePlaceholder')}
                                            autoComplete="off"
                                            aria-invalid={Boolean(formErrors.code)}
                                            aria-describedby={formErrors.code ? 'discount-code-error' : 'discount-code-help'}
                                        />
                                        {formErrors.code ? (
                                            <p id="discount-code-error" className="text-sm text-danger">{formErrors.code}</p>
                                        ) : (
                                            <p id="discount-code-help" className="text-xs text-muted">{t('CheckoutCodeHint')}</p>
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-type" className="label">{t('DiscountType')} *</label>
                                        <select
                                            id="discount-type"
                                            value={form.discount_type}
                                            onChange={(event) => updateField('discount_type', event.target.value as DiscountType)}
                                        >
                                            <option value="PERCENTAGE">{t('Percentage')} (%)</option>
                                            <option value="FIXED">{t('FixedAmount')} ({currency.symbol})</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-value" className="label">
                                            {t('Value')} ({form.discount_type === 'PERCENTAGE' ? '%' : currency.symbol}) *
                                        </label>
                                        <input
                                            id="discount-value"
                                            type="text"
                                            inputMode="decimal"
                                            value={form.value}
                                            onChange={(event) => updateField('value', normalizeDecimalInput(event.target.value))}
                                            placeholder={form.discount_type === 'PERCENTAGE' ? '10' : '25,00'}
                                            aria-invalid={Boolean(formErrors.value)}
                                            aria-describedby={formErrors.value ? 'discount-value-error' : undefined}
                                        />
                                        {formErrors.value && <p id="discount-value-error" className="text-sm text-danger">{formErrors.value}</p>}
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-minimum" className="label">{t('MinimumCartAmount', { symbol: currency.symbol })}</label>
                                        <input
                                            id="discount-minimum"
                                            type="text"
                                            inputMode="decimal"
                                            value={form.minimum_amount}
                                            onChange={(event) => updateField('minimum_amount', normalizeDecimalInput(event.target.value))}
                                            placeholder="0,00"
                                            aria-invalid={Boolean(formErrors.minimum_amount)}
                                            aria-describedby={formErrors.minimum_amount ? 'discount-minimum-error' : 'discount-minimum-help'}
                                        />
                                        {formErrors.minimum_amount ? (
                                            <p id="discount-minimum-error" className="text-sm text-danger">{formErrors.minimum_amount}</p>
                                        ) : (
                                            <p id="discount-minimum-help" className="text-xs text-muted">{t('NoMinimumHint')}</p>
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-max-uses" className="label">{t('MaximumUses')}</label>
                                        <input
                                            id="discount-max-uses"
                                            type="number"
                                            min="1"
                                            step="1"
                                            value={form.max_uses}
                                            onChange={(event) => updateField('max_uses', event.target.value)}
                                            placeholder={t('Unlimited')}
                                            aria-invalid={Boolean(formErrors.max_uses)}
                                            aria-describedby={formErrors.max_uses ? 'discount-max-uses-error' : 'discount-max-uses-help'}
                                        />
                                        {formErrors.max_uses ? (
                                            <p id="discount-max-uses-error" className="text-sm text-danger">{formErrors.max_uses}</p>
                                        ) : (
                                            <p id="discount-max-uses-help" className="text-xs text-muted">{t('UnlimitedUseHint')}</p>
                                        )}
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-start-date" className="label">{t('StartDate')}</label>
                                        <input
                                            id="discount-start-date"
                                            type="date"
                                            value={form.start_date}
                                            max={form.end_date || undefined}
                                            onChange={(event) => updateField('start_date', event.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="discount-end-date" className="label">{t('EndDate')}</label>
                                        <input
                                            id="discount-end-date"
                                            type="date"
                                            value={form.end_date}
                                            min={form.start_date || undefined}
                                            onChange={(event) => updateField('end_date', event.target.value)}
                                            aria-invalid={Boolean(formErrors.end_date)}
                                            aria-describedby={formErrors.end_date ? 'discount-end-date-error' : undefined}
                                        />
                                        {formErrors.end_date && <p id="discount-end-date-error" className="text-sm text-danger">{formErrors.end_date}</p>}
                                    </div>
                                </div>

                                <label className="card p-4 flex items-center justify-between gap-4 cursor-pointer" htmlFor="discount-active">
                                    <span>
                                        <span className="font-semibold block">{t('ActiveDiscount')}</span>
                                        <span className="text-sm text-muted">
                                            {t('InactiveDiscountHint')}
                                        </span>
                                    </span>
                                    <input
                                        id="discount-active"
                                        type="checkbox"
                                        className="w-5 h-5"
                                        checked={form.active}
                                        onChange={(event) => updateField('active', event.target.checked)}
                                    />
                                </label>
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={closeModal} disabled={isSaving}>
                                    {t('Cancel')}
                                </button>
                                <button type="submit" className="btn-primary" disabled={isSaving}>
                                    <Save size={18} aria-hidden="true" />
                                    {isSaving ? t('Saving') : editingDiscount ? t('Save') : t('CreateDiscount')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(discountToDelete)}
                title={t('DeleteDiscountTitle')}
                description={discountToDelete
                    ? t('DeleteDiscountDescription', { code: discountToDelete.code || discountToDelete.name })
                    : ''}
                confirmLabel={t('Delete')}
                busy={deleteMutation.isPending}
                onCancel={() => setDiscountToDelete(null)}
                onConfirm={() => {
                    if (discountToDelete) deleteMutation.mutate(discountToDelete.id);
                }}
            />
        </div>
    );
}
