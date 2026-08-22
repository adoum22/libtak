import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import { buildWhatsAppReminderUrl, getCreditAgeInDays } from '../utils/creditReminder';
import useCurrency from '../hooks/useCurrency';
import {
    clearOperationAttempt,
    getOrCreateOperationAttempt,
    loadOperationAttempt,
    operationFingerprint,
    persistOperationAttempt,
    type OperationAttempt,
} from '../utils/operationAttempt';
import {
    CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY,
    CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY,
} from '../utils/privateSessionStorage';
import {
    CreditCard,
    Search,
    User,
    X,
    Check,
    Phone,
    Receipt,
    Banknote,
    Clock3,
    MessageCircle,
    RotateCcw,
} from 'lucide-react';

interface CreditPayment {
    id: number;
    amount: number;
    note: string;
    operation_id: string;
    status: 'ACTIVE' | 'REVERSED';
    status_display: string;
    created_by?: number;
    created_by_name?: string;
    created_at: string;
    reversed_by?: number | null;
    reversed_by_name?: string | null;
    reversed_at?: string | null;
    reversal_reason?: string;
    reversal_operation_id?: string;
}

interface SaleItem {
    id: number;
    product_name: string;
    quantity: number;
    unit_price_ht: number;
}

interface CreditSale {
    id: number;
    sale: number;
    sale_date: string;
    sale_total: number;
    adjusted_total?: number;
    sale_discount?: number;
    customer: number;
    customer_name: string;
    customer_phone?: string;
    status: 'UNPAID' | 'PARTIAL' | 'PAID';
    status_display: string;
    paid_amount: number;
    remaining_amount: number;
    created_at: string;
    items?: SaleItem[];
    payments?: CreditPayment[];
}

type StatusFilter = 'ALL' | 'OPEN' | 'UNPAID' | 'PARTIAL' | 'PAID';

const statusBadge = (status: CreditSale['status']) => {
    if (status === 'PAID') return 'badge-success';
    if (status === 'PARTIAL') return 'badge-warning';
    return 'badge-danger';
};

const formatDate = (iso: string, locale: string) => {
    try {
        return new Date(iso).toLocaleString(locale, {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
};

export default function Credit() {
    const { t, i18n } = useTranslation();
    const queryClient = useQueryClient();
    const toast = useToast();
    const currency = useCurrency();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [paymentInput, setPaymentInput] = useState('');
    const [paymentNote, setPaymentNote] = useState('');
    const [reversingPayment, setReversingPayment] = useState<CreditPayment | null>(null);
    const [reversalReason, setReversalReason] = useState('');
    const paymentAttemptRef = useRef<OperationAttempt | null>(
        loadOperationAttempt(CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY),
    );
    const reversalAttemptRef = useRef<OperationAttempt | null>(
        loadOperationAttempt(CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY),
    );

    // Debounce de la recherche pour éviter une requête par caractère
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(t);
    }, [search]);

    const selectCredit = (creditId: number) => {
        setPaymentInput('');
        setPaymentNote('');
        setSelectedId(creditId);
    };

    const closeCredit = () => {
        setPaymentInput('');
        setPaymentNote('');
        setReversingPayment(null);
        setReversalReason('');
        setSelectedId(null);
    };

    const { data: currentUser } = useQuery<{ role?: string }>({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(res => res.data),
    });
    const isAdmin = currentUser?.role === 'ADMIN';

    const { data: credits = [], isLoading, isError, refetch } = useQuery<CreditSale[]>({
        queryKey: ['credits', statusFilter, debouncedSearch],
        queryFn: () => {
            const params = new URLSearchParams();
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (statusFilter === 'UNPAID' || statusFilter === 'PARTIAL' || statusFilter === 'PAID') {
                params.set('status', statusFilter);
            }
            return client.get(`/credit/credits/?${params.toString()}`).then(res => {
                const data = res.data;
                return Array.isArray(data) ? data : (data.results || []);
            });
        },
    });

    const filteredCredits = credits.filter(c => {
        if (statusFilter === 'OPEN') return c.status !== 'PAID';
        return true;
    });

    const {
        data: detail,
        isLoading: detailLoading,
        isError: detailError,
        refetch: refetchDetail,
    } = useQuery<CreditSale>({
        queryKey: ['credit-detail', selectedId],
        queryFn: () => client.get(`/credit/credits/${selectedId}/`).then(res => res.data),
        enabled: !!selectedId,
    });

    const payMutation = useMutation({
        mutationFn: (data: { amount: number; note: string; operation_id: string }) =>
            client.post(
                `/credit/credits/${selectedId}/pay/`,
                data,
                { headers: { 'Idempotency-Key': data.operation_id } },
            ).then(res => res.data),
        onSuccess: () => {
            clearOperationAttempt(CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY);
            paymentAttemptRef.current = null;
            toast.success(t('PaymentRecorded'));
            setPaymentInput('');
            setPaymentNote('');
            queryClient.invalidateQueries({ queryKey: ['credits'] });
            queryClient.invalidateQueries({ queryKey: ['credit-detail', selectedId] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
        },
        onError: (error: unknown) => {
            toast.error(t('PaymentError', { message: getApiErrorMessage(error) }));
        },
    });

    const reversePaymentMutation = useMutation({
        mutationFn: ({ creditId, paymentId, reason, operationId }: {
            creditId: number;
            paymentId: number;
            reason: string;
            operationId: string;
        }) => client.post(
            `/credit/credits/${creditId}/payments/${paymentId}/reverse/`,
            { reason, operation_id: operationId },
            { headers: { 'Idempotency-Key': operationId } },
        ).then(res => res.data),
        onSuccess: () => {
            clearOperationAttempt(CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY);
            reversalAttemptRef.current = null;
            toast.success(t('Reversed'));
            setReversingPayment(null);
            setReversalReason('');
            queryClient.invalidateQueries({ queryKey: ['credits'] });
            queryClient.invalidateQueries({ queryKey: ['credit-detail', selectedId] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
        },
        onError: (error: unknown) => {
            toast.error(t('PaymentError', { message: getApiErrorMessage(error) }));
        },
    });

    const recordPayment = (amount: number) => {
        if (!selectedId) return;
        const normalizedAmount = Number(amount.toFixed(2));
        const note = paymentNote.trim();
        const fingerprint = operationFingerprint([
            selectedId,
            normalizedAmount.toFixed(2),
            note,
        ]);
        const attempt = getOrCreateOperationAttempt(
            fingerprint,
            paymentAttemptRef.current,
        );
        paymentAttemptRef.current = attempt;
        persistOperationAttempt(CREDIT_PAYMENT_ATTEMPT_STORAGE_KEY, attempt);
        payMutation.mutate({
            amount: normalizedAmount,
            note,
            operation_id: attempt.key,
        });
    };

    const submitPayment = () => {
        if (!detail) return;
        const remaining = Number(detail.remaining_amount) || 0;
        let amount = parseDecimalInput(paymentInput) || 0;
        if (amount <= 0) {
            toast.error(t('InvalidAmount'));
            return;
        }
        // Si l'utilisateur a tapé exactement le restant arrondi à 2 décimales,
        // on envoie la valeur exacte du backend pour éviter un reliquat d'arrondi.
        if (Math.abs(amount - Number(remaining.toFixed(2))) < 0.005) {
            amount = remaining;
        }
        if (amount > remaining + 0.01) {
            toast.error(t('PaymentExceedsBalance'));
            return;
        }
        recordPayment(amount);
    };

    const payFullBalance = () => {
        if (!detail) return;
        recordPayment(Number(detail.remaining_amount) || 0);
    };

    const submitReversal = () => {
        if (!detail || !reversingPayment) return;
        const reason = reversalReason.trim();
        if (reason.length < 3) {
            toast.error(t('RequiredReason'));
            return;
        }
        const fingerprint = operationFingerprint([
            detail.id,
            reversingPayment.id,
            reason,
        ]);
        const attempt = getOrCreateOperationAttempt(
            fingerprint,
            reversalAttemptRef.current,
        );
        reversalAttemptRef.current = attempt;
        persistOperationAttempt(CREDIT_REVERSAL_ATTEMPT_STORAGE_KEY, attempt);
        reversePaymentMutation.mutate({
            creditId: detail.id,
            paymentId: reversingPayment.id,
            reason,
            operationId: attempt.key,
        });
    };

    const sendPaymentReminder = (credit: CreditSale) => {
        if (!credit.customer_phone) return;
        const message = t('CreditReminderMessage', {
            customer: credit.customer_name,
            amount: currency.format(credit.remaining_amount),
            id: credit.id,
        });
        const reminderUrl = buildWhatsAppReminderUrl(credit.customer_phone, message);
        if (!reminderUrl) {
            toast.error(t('InvalidCustomerPhone'));
            return;
        }
        const reminderWindow = window.open(
            reminderUrl,
            '_blank',
        );
        if (reminderWindow) reminderWindow.opener = null;
        else toast.error(t('PopupBlocked'));
    };

    const totals = filteredCredits.reduce(
        (acc, c) => {
            acc.total += Number(c.adjusted_total ?? c.sale_total) || 0;
            acc.paid += Number(c.paid_amount) || 0;
            acc.remaining += Number(c.remaining_amount) || 0;
            return acc;
        },
        { total: 0, paid: 0, remaining: 0 },
    );
    const agedOpenCredits = filteredCredits.filter((credit) => (
        credit.status !== 'PAID' && getCreditAgeInDays(credit.created_at || credit.sale_date) >= 30
    ));

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-warning text-white flex items-center justify-center">
                        <CreditCard size={22} />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold">{t('Credit')}</h1>
                        <p className="text-muted text-sm">{t('CreditSubtitle')}</p>
                    </div>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold">{t('TotalCredited')}</p>
                    <p className="text-2xl font-bold mt-1">{currency.format(totals.total)}</p>
                </div>
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold">{t('AlreadyPaid')}</p>
                    <p className="text-2xl font-bold mt-1 text-success">{currency.format(totals.paid)}</p>
                </div>
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold">{t('RemainingDue')}</p>
                    <p className="text-2xl font-bold mt-1 text-danger">{currency.format(totals.remaining)}</p>
                </div>
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold flex items-center gap-1">
                        <Clock3 size={14} /> {t('AgedCredits')}
                    </p>
                    <p className={`text-2xl font-bold mt-1 ${agedOpenCredits.length ? 'text-warning' : 'text-success'}`}>
                        {agedOpenCredits.length}
                    </p>
                    <p className="text-xs text-muted mt-1">{t('AgedCreditsHint')}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="card p-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                    <input
                        type="text"
                        placeholder={t('SearchCustomer')}
                        aria-label={t('SearchCustomer')}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="input w-full pl-10"
                    />
                </div>
                <div className="flex gap-1 bg-tertiary/40 p-1 rounded-lg" role="group" aria-label={t('Status')}>
                    {([
                        { key: 'OPEN', label: t('OpenCredits') },
                        { key: 'UNPAID', label: t('Unpaid') },
                        { key: 'PARTIAL', label: t('Partial') },
                        { key: 'PAID', label: t('Paid') },
                        { key: 'ALL', label: t('All') },
                    ] as const).map(opt => (
                        <button
                            key={opt.key}
                            type="button"
                            onClick={() => setStatusFilter(opt.key)}
                            aria-pressed={statusFilter === opt.key}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${statusFilter === opt.key ? 'bg-secondary shadow text-accent' : 'text-muted hover:text-primary'}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Credits list */}
            <div className="card min-w-0 max-w-full overflow-hidden">
                {isLoading ? (
                    <p className="p-6 text-muted text-center" role="status">{t('Loading')}</p>
                ) : isError ? (
                    <div className="network-error-state m-4" role="alert">
                        <p className="font-semibold">{t('ListUnavailable')}</p>
                        <p className="text-sm mt-2">{t('CheckConnection')}</p>
                        <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button>
                    </div>
                ) : filteredCredits.length === 0 ? (
                    <p className="p-6 text-muted text-center">{t('NoCreditsForFilters')}</p>
                ) : (
                    <>
                    <div className="divide-y divide-border md:hidden">
                        {filteredCredits.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                className="w-full p-4 text-left hover:bg-tertiary/30"
                                aria-label={`${t('Details')}: ${c.customer_name}`}
                                onClick={() => selectCredit(c.id)}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-semibold break-words">{c.customer_name}</p>
                                        <p className="mt-1 text-xs text-muted">{formatDate(c.sale_date, i18n.language)}</p>
                                        {c.customer_phone && (
                                            <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                                                <Phone size={12} aria-hidden="true" /> {c.customer_phone}
                                            </p>
                                        )}
                                    </div>
                                    <span className={`badge shrink-0 ${statusBadge(c.status)}`}>
                                        {t(c.status === 'PAID' ? 'Paid' : c.status === 'PARTIAL' ? 'Partial' : 'Unpaid')}
                                    </span>
                                </div>
                                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <dt className="text-xs font-semibold uppercase text-muted">{t('Total')}</dt>
                                        <dd className="font-mono">{currency.format(c.adjusted_total ?? c.sale_total)}</dd>
                                    </div>
                                    <div className="text-right">
                                        <dt className="text-xs font-semibold uppercase text-muted">{t('PaidAmount')}</dt>
                                        <dd className="font-mono text-success">{currency.format(c.paid_amount)}</dd>
                                    </div>
                                    <div className="col-span-2 rounded-lg bg-tertiary/40 p-2">
                                        <dt className="text-xs font-semibold uppercase text-muted">{t('Remaining')}</dt>
                                        <dd className="font-mono font-bold text-danger">{currency.format(c.remaining_amount)}</dd>
                                    </div>
                                </dl>
                                {c.status !== 'PAID' && getCreditAgeInDays(c.created_at || c.sale_date) >= 30 && (
                                    <span className="badge badge-warning mt-3">
                                        {t('CreditAgeDays', { count: getCreditAgeInDays(c.created_at || c.sale_date) })}
                                    </span>
                                )}
                                <span className="mt-3 block text-sm font-semibold text-accent">{t('Details')}</span>
                            </button>
                        ))}
                    </div>
                    <div className="max-md:hidden max-w-full overflow-x-auto">
                        <table className="w-full text-sm">
                            <caption className="sr-only">{t('Credit')}</caption>
                            <thead className="bg-tertiary/40 text-muted text-xs uppercase">
                                <tr>
                                    <th scope="col" className="p-3 text-left">{t('Date')}</th>
                                    <th scope="col" className="p-3 text-left">{t('CreditCustomer')}</th>
                                    <th scope="col" className="p-3 text-right">{t('Total')}</th>
                                    <th scope="col" className="p-3 text-right">{t('PaidAmount')}</th>
                                    <th scope="col" className="p-3 text-right">{t('Remaining')}</th>
                                    <th scope="col" className="p-3 text-left">{t('Status')}</th>
                                    <th scope="col" className="p-3"><span className="sr-only">{t('Actions')}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCredits.map(c => (
                                    <tr
                                        key={c.id}
                                        className="border-t border-border hover:bg-tertiary/30 cursor-pointer"
                                        onClick={() => selectCredit(c.id)}
                                    >
                                        <td className="p-3 whitespace-nowrap text-muted">{formatDate(c.sale_date, i18n.language)}</td>
                                        <td className="p-3">
                                            <div className="font-medium">{c.customer_name}</div>
                                            {c.customer_phone && (
                                                <div className="text-xs text-muted flex items-center gap-1">
                                                    <Phone size={11} /> {c.customer_phone}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-right whitespace-nowrap font-mono">{currency.format(c.adjusted_total ?? c.sale_total)}</td>
                                        <td className="p-3 text-right whitespace-nowrap font-mono text-success">{currency.format(c.paid_amount)}</td>
                                        <td className="p-3 text-right whitespace-nowrap font-mono text-danger">{currency.format(c.remaining_amount)}</td>
                                        <td className="p-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`badge ${statusBadge(c.status)}`}>{t(c.status === 'PAID' ? 'Paid' : c.status === 'PARTIAL' ? 'Partial' : 'Unpaid')}</span>
                                                {c.status !== 'PAID' && getCreditAgeInDays(c.created_at || c.sale_date) >= 30 && (
                                                    <span className="badge badge-warning">
                                                        {t('CreditAgeDays', { count: getCreditAgeInDays(c.created_at || c.sale_date) })}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-3 text-right">
                                            <button className="btn-ghost btn-sm">{t('Details')}</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    </>
                )}
            </div>

            {/* Detail modal */}
            {selectedId && !detail && (detailLoading || detailError) && createPortal(
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="presentation">
                    <button
                        type="button"
                        className="absolute inset-0 cursor-default"
                        aria-label={t('Close')}
                        onClick={closeCredit}
                        tabIndex={-1}
                    />
                    <div
                        className="relative card w-full max-w-md p-6 text-center"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="credit-detail-state-title"
                    >
                        <h2 id="credit-detail-state-title" className="text-lg font-bold">
                            {detailError ? t('DataUnavailable') : t('Loading')}
                        </h2>
                        {detailLoading ? (
                            <p className="text-muted mt-3" role="status">{t('Loading')}</p>
                        ) : (
                            <div className="mt-3" role="alert">
                                <p className="text-muted">{t('CheckConnection')}</p>
                                <button type="button" className="btn-secondary mt-4" onClick={() => void refetchDetail()}>{t('Retry')}</button>
                            </div>
                        )}
                        <button type="button" className="btn-ghost mt-4" data-modal-close onClick={closeCredit}>{t('Close')}</button>
                    </div>
                </div>,
                document.body,
            )}
            {selectedId && detail && createPortal(
                <div
                    className="fixed inset-0 z-40 flex items-center justify-center overflow-x-hidden bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeCredit}
                >
                    <div
                        className="card min-w-0 w-full max-w-2xl max-h-[90vh] overflow-x-hidden overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="credit-detail-title"
                    >
                        <div className="card-header flex items-center justify-between bg-warning text-white">
                            <h3 id="credit-detail-title" className="text-lg font-bold flex items-center gap-2">
                                <CreditCard size={20} />
                                {t('CreditDetail', { id: detail.id, customer: detail.customer_name })}
                            </h3>
                            <button type="button" data-modal-close onClick={closeCredit} aria-label={t('Close')} className="hover:bg-white/20 p-1 rounded">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-5">
                            {/* Summary */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                <div className="bg-tertiary/40 rounded-lg p-3">
                                    <p className="text-xs uppercase text-muted">{t('Total')}</p>
                                    <p className="font-bold text-lg">{currency.format(detail.adjusted_total ?? detail.sale_total)}</p>
                                    {Number(detail.adjusted_total ?? detail.sale_total) !== Number(detail.sale_total) && (
                                        <p className="text-xs text-muted mt-1">
                                            {t('Sale')}: {currency.format(detail.sale_total)}
                                        </p>
                                    )}
                                </div>
                                <div className="bg-tertiary/40 rounded-lg p-3">
                                    <p className="text-xs uppercase text-muted">{t('PaidAmount')}</p>
                                    <p className="font-bold text-lg text-success">{currency.format(detail.paid_amount)}</p>
                                </div>
                                <div className="bg-tertiary/40 rounded-lg p-3">
                                    <p className="text-xs uppercase text-muted">{t('Remaining')}</p>
                                    <p className="font-bold text-lg text-danger">{currency.format(detail.remaining_amount)}</p>
                                </div>
                            </div>

                            {detail.customer_phone && (
                                <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-border p-3">
                                    <div className="flex items-center gap-2 text-sm text-muted">
                                        <User size={16} />
                                        <span>{detail.customer_name}</span>
                                        <Phone size={14} className="ml-2" />
                                        <span>{detail.customer_phone}</span>
                                    </div>
                                    {detail.status !== 'PAID' && (
                                        <button
                                            type="button"
                                            className="btn-secondary btn-sm"
                                            onClick={() => sendPaymentReminder(detail)}
                                        >
                                            <MessageCircle size={17} />
                                            {t('SendWhatsAppReminder')}
                                        </button>
                                    )}
                                </div>
                            )}

                            {detail.status !== 'PAID' && getCreditAgeInDays(detail.created_at || detail.sale_date) >= 30 && (
                                <div className="rounded-xl bg-warning-light text-warning p-3 text-sm flex items-start gap-2">
                                    <Clock3 size={18} className="shrink-0 mt-0.5" />
                                    <span>{t('AgedCreditWarning', { count: getCreditAgeInDays(detail.created_at || detail.sale_date) })}</span>
                                </div>
                            )}

                            {/* Items */}
                            <div>
                                <h4 className="font-semibold flex items-center gap-2 mb-2">
                                    <Receipt size={16} /> {t('Items')}
                                </h4>
                                <div className="space-y-2 md:hidden">
                                    {(detail.items || []).map(item => (
                                        <article key={item.id} className="rounded-xl border border-border p-3">
                                            <h5 className="font-semibold break-words">{item.product_name}</h5>
                                            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                                                <div>
                                                    <dt className="text-xs font-semibold uppercase text-muted">{t('AbbreviatedQuantity')}</dt>
                                                    <dd>{item.quantity}</dd>
                                                </div>
                                                <div className="text-right">
                                                    <dt className="text-xs font-semibold uppercase text-muted">{t('UnitPriceShort')}</dt>
                                                    <dd className="font-mono">{currency.format(item.unit_price_ht)}</dd>
                                                </div>
                                            </dl>
                                        </article>
                                    ))}
                                </div>
                                <div className="max-md:hidden max-w-full overflow-x-auto rounded-lg border border-border">
                                    <table className="w-full text-sm">
                                        <caption className="sr-only">{t('Products')}</caption>
                                        <thead className="bg-tertiary/40 text-muted text-xs uppercase">
                                            <tr>
                                                <th scope="col" className="p-2 text-left">{t('Product')}</th>
                                                <th scope="col" className="p-2 text-right">{t('AbbreviatedQuantity')}</th>
                                                <th scope="col" className="p-2 text-right">{t('UnitPriceShort')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(detail.items || []).map(item => (
                                                <tr key={item.id} className="border-t border-border">
                                                    <td className="p-2">{item.product_name}</td>
                                                    <td className="p-2 text-right">{item.quantity}</td>
                                                    <td className="p-2 text-right font-mono">{currency.format(item.unit_price_ht)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Payments history */}
                            <div>
                                <h4 className="font-semibold flex items-center gap-2 mb-2">
                                    <Banknote size={16} /> {t('PaymentHistory')}
                                </h4>
                                {(detail.payments || []).length === 0 ? (
                                    <p className="text-sm text-muted">{t('NoPayments')}</p>
                                ) : (
                                    <>
                                        <div className="space-y-3 md:hidden">
                                            {(detail.payments || []).map(p => {
                                                const reversed = p.status === 'REVERSED';
                                                return (
                                                    <article key={p.id} className={`rounded-xl border border-border p-3 ${reversed ? 'opacity-70' : ''}`}>
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div>
                                                                <p className="text-xs text-muted">{formatDate(p.created_at, i18n.language)}</p>
                                                                <p className={`mt-1 font-mono text-lg font-bold ${reversed ? 'line-through text-muted' : 'text-success'}`}>
                                                                    {reversed ? '' : '+'}{currency.format(p.amount)}
                                                                </p>
                                                            </div>
                                                            <span className={`badge ${reversed ? 'badge-danger' : 'badge-success'}`}>
                                                                {reversed ? t('Reversed') : t('Active')}
                                                            </span>
                                                        </div>
                                                        <dl className="mt-3 grid gap-2 text-sm">
                                                            <div>
                                                                <dt className="text-xs font-semibold uppercase text-muted">{t('Notes')}</dt>
                                                                <dd>{p.note || '—'}</dd>
                                                                {reversed && p.reversal_reason && (
                                                                    <dd className="mt-1 text-xs text-danger">{t('Reason')}: {p.reversal_reason}</dd>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <dt className="text-xs font-semibold uppercase text-muted">{t('By')}</dt>
                                                                <dd>{p.created_by_name || '—'}</dd>
                                                                {reversed && p.reversed_at && (
                                                                    <dd className="mt-1 text-xs text-muted">
                                                                        {t('Reversed')}: {formatDate(p.reversed_at, i18n.language)}
                                                                        {p.reversed_by_name ? ` · ${p.reversed_by_name}` : ''}
                                                                    </dd>
                                                                )}
                                                            </div>
                                                        </dl>
                                                        {isAdmin && !reversed && (
                                                            <button
                                                                type="button"
                                                                className="btn-ghost btn-sm mt-3 w-full justify-center text-danger"
                                                                onClick={() => {
                                                                    setReversingPayment(p);
                                                                    setReversalReason('');
                                                                }}
                                                            >
                                                                <RotateCcw size={14} /> {t('Reverse')}
                                                            </button>
                                                        )}
                                                    </article>
                                                );
                                            })}
                                        </div>
                                        <div className="max-md:hidden max-w-full overflow-x-auto rounded-lg border border-border">
                                        <table className="w-full min-w-[42rem] text-sm">
                                            <caption className="sr-only">{t('PaymentHistory')}</caption>
                                            <thead className="bg-tertiary/40 text-muted text-xs uppercase">
                                                <tr>
                                                    <th scope="col" className="p-2 text-left">{t('Date')}</th>
                                                    <th scope="col" className="p-2 text-right">{t('AmountGiven')}</th>
                                                    <th scope="col" className="p-2 text-left">{t('Notes')}</th>
                                                    <th scope="col" className="p-2 text-left">{t('By')}</th>
                                                    <th scope="col" className="p-2 text-left">{t('Status')}</th>
                                                    <th scope="col" className="p-2 text-right"><span className="sr-only">{t('Actions')}</span></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(detail.payments || []).map(p => {
                                                    const reversed = p.status === 'REVERSED';
                                                    return (
                                                        <tr key={p.id} className={`border-t border-border ${reversed ? 'opacity-70' : ''}`}>
                                                            <td className="p-2 text-muted">{formatDate(p.created_at, i18n.language)}</td>
                                                            <td className={`p-2 text-right font-mono ${reversed ? 'line-through text-muted' : 'text-success'}`}>
                                                                {reversed ? '' : '+'}{currency.format(p.amount)}
                                                            </td>
                                                            <td className="p-2">
                                                                <span>{p.note || '—'}</span>
                                                                {reversed && p.reversal_reason && (
                                                                    <span className="block text-xs text-danger mt-1">
                                                                        {t('Reason')}: {p.reversal_reason}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="p-2 text-muted">
                                                                <span>{p.created_by_name || '—'}</span>
                                                                {reversed && p.reversed_at && (
                                                                    <span className="block text-xs mt-1">
                                                                        {t('Reversed')}: {formatDate(p.reversed_at, i18n.language)}
                                                                        {p.reversed_by_name ? ` · ${p.reversed_by_name}` : ''}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="p-2">
                                                                <span className={`badge ${reversed ? 'badge-danger' : 'badge-success'}`}>
                                                                    {reversed ? t('Reversed') : t('Active')}
                                                                </span>
                                                            </td>
                                                            <td className="p-2 text-right">
                                                                {isAdmin && !reversed && (
                                                                    <button
                                                                        type="button"
                                                                        className="btn-ghost btn-sm text-danger"
                                                                        onClick={() => {
                                                                            setReversingPayment(p);
                                                                            setReversalReason('');
                                                                        }}
                                                                    >
                                                                        <RotateCcw size={14} /> {t('Reverse')}
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Pay form */}
                            {detail.status !== 'PAID' && (
                                <form
                                    className="rounded-xl border-2 border-warning/40 bg-warning-light/30 p-4 space-y-3"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        submitPayment();
                                    }}
                                >
                                    <h4 className="font-bold flex items-center gap-2">
                                        <Check size={18} /> {t('RecordCashPayment')}
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="credit-payment-amount" className="text-xs font-medium text-muted">{t('MaximumAmount', { amount: currency.format(detail.remaining_amount) })}</label>
                                            <div className="flex rounded-xl border-2 border-border bg-secondary focus-within:border-warning mt-1">
                                                <input
                                                    id="credit-payment-amount"
                                                    type="text"
                                                    inputMode="decimal"
                                                    required
                                                    placeholder="0.00"
                                                    value={paymentInput}
                                                    onChange={e => setPaymentInput(normalizeDecimalInput(e.target.value))}
                                                    className="money-input w-full px-3 py-2 font-bold"
                                                />
                                                <span className="px-3 flex items-center text-muted font-bold border-l border-border">{currency.symbol}</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="credit-payment-note" className="text-xs font-medium text-muted">{t('OptionalNoteLabel')}</label>
                                            <input
                                                id="credit-payment-note"
                                                type="text"
                                                value={paymentNote}
                                                onChange={e => setPaymentNote(e.target.value)}
                                                maxLength={200}
                                                className="input w-full mt-1"
                                                placeholder={t('DepositExample')}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={payFullBalance}
                                            disabled={payMutation.isPending}
                                            className="btn-ghost btn-sm"
                                        >
                                            {t('FullBalance')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={payMutation.isPending}
                                            className="btn-primary flex-1 py-2 font-bold"
                                        >
                                            {payMutation.isPending ? t('Validating') : t('RecordPayment')}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>,
                document.body,
            )}

            {reversingPayment && detail && createPortal(
                <div
                    className="modal-overlay z-[60]"
                    role="presentation"
                    onClick={() => {
                        if (!reversePaymentMutation.isPending) {
                            setReversingPayment(null);
                            setReversalReason('');
                        }
                    }}
                >
                    <div
                        className="modal max-w-md"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="reverse-credit-payment-title"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="modal-header block">
                            <h2 id="reverse-credit-payment-title" className="text-xl font-bold">
                                {t('Reverse')}
                            </h2>
                            <p className="text-sm text-muted mt-1">
                                {currency.format(reversingPayment.amount)} · {detail.customer_name}
                            </p>
                        </div>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                submitReversal();
                            }}
                        >
                            <div className="card-body">
                                <label htmlFor="credit-reversal-reason" className="block">
                                    <span className="text-sm font-semibold">{t('RequiredReason')}</span>
                                    <textarea
                                        id="credit-reversal-reason"
                                        value={reversalReason}
                                        onChange={event => setReversalReason(event.target.value)}
                                        minLength={3}
                                        maxLength={200}
                                        rows={3}
                                        required
                                        className="w-full mt-1"
                                        autoFocus
                                    />
                                </label>
                            </div>
                            <div className="modal-footer" style={{ position: 'static' }}>
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    data-modal-close
                                    disabled={reversePaymentMutation.isPending}
                                    onClick={() => {
                                        setReversingPayment(null);
                                        setReversalReason('');
                                    }}
                                >
                                    {t('Cancel')}
                                </button>
                                <button
                                    type="submit"
                                    className="btn-danger"
                                    disabled={reversalReason.trim().length < 3 || reversePaymentMutation.isPending}
                                >
                                    <RotateCcw size={16} />
                                    {reversePaymentMutation.isPending ? t('Reversing') : t('Confirm')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
