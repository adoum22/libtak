import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import Pagination from '../components/Pagination';
import useCurrency from '../hooks/useCurrency';
import {
    clearOperationAttempt,
    getOrCreateOperationAttempt,
    loadOperationAttempt,
    operationFingerprint,
    persistOperationAttempt,
    type OperationAttempt,
} from '../utils/operationAttempt';
import { RETURN_CREATION_ATTEMPT_STORAGE_KEY } from '../utils/privateSessionStorage';
import {
    RotateCcw,
    Search,
    Check,
    X,
    ChevronDown,
    ChevronUp,
    Calendar
} from 'lucide-react';

interface Sale {
    id: number;
    total_ttc: number;
    payment_method: PaymentMethod;
    created_at: string;
    items: SaleItem[];
    user_name?: string;
}

interface SaleItem {
    id: number;
    product_name: string;
    quantity: number;
    returnable_quantity: number;
    unit_price_ht: number;
    tva_rate: number;
}

interface Return {
    id: number;
    sale: number;
    sale_total: number;
    status: string;
    status_display: string;
    reason: string;
    refund_amount: number;
    cash_refund_amount: number;
    refund_method: PaymentMethod;
    items: ReturnItem[];
    processed_by_name: string;
    created_at: string;
}

interface ReturnItem {
    id: number;
    sale_item: number;
    quantity: number;
    product_name: string;
    unit_price: number;
    restock: boolean;
}

type PaymentMethod = 'CASH' | 'CARD' | 'CREDIT' | 'OTHER';

interface CreateReturnPayload {
    sale: number;
    reason: string;
    refund_method: PaymentMethod;
    items: {
        sale_item: number;
        quantity: number;
        restock: boolean;
    }[];
}

interface ReturnsPage {
    count: number;
    results: Return[];
}

const PAGE_SIZE = 50;

export default function Returns() {
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
    const paymentMethodLabels: Record<PaymentMethod, string> = {
        CASH: t('Cash'),
        CARD: t('Card'),
        CREDIT: t('Credit'),
        OTHER: t('Other'),
    };
    const returnStatusLabel = (status: string, fallback: string) => ({
        PENDING: t('Pending'),
        APPROVED: t('Approved'),
        REJECTED: t('Rejected'),
        COMPLETED: t('Completed'),
    }[status] || fallback);
    const queryClient = useQueryClient();
    const toast = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
    const [returnItems, setReturnItems] = useState<{ saleItemId: number; quantity: number; restock: boolean }[]>([]);
    const [reason, setReason] = useState('');
    const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [expandedReturn, setExpandedReturn] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [returnAttempt, setReturnAttempt] = useState<OperationAttempt | null>(() => (
        loadOperationAttempt(RETURN_CREATION_ATTEMPT_STORAGE_KEY)
    ));

    // Fetch returns list
    const { data: returnsPage, isLoading: loadingReturns, isError: returnsError, refetch: refetchReturns } = useQuery<ReturnsPage>({
        queryKey: ['returns', page],
        queryFn: () => client.get('/sales/returns/', { params: { page } }).then(res => ({
            count: Number(res.data?.count ?? (Array.isArray(res.data) ? res.data.length : 0)),
            results: res.data?.results ?? (Array.isArray(res.data) ? res.data : []),
        })),
        placeholderData: previous => previous,
    });
    const returns = returnsPage?.results ?? [];
    const returnsCount = returnsPage?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(returnsCount / PAGE_SIZE));

    // Fetch recent sales for easy selection
    const { data: recentSales = [], isLoading: salesLoading, isError: salesError, refetch: refetchSales } = useQuery<Sale[]>({
        queryKey: ['recentSales', searchTerm],
        queryFn: () => client.get('/sales/sales/', { params: { search: searchTerm.trim() || undefined } }).then(res => {
            const data = res.data;
            return Array.isArray(data) ? data : (data.results || []);
        }),
        enabled: showCreateForm
    });

    const filteredSales = recentSales;

    // Select a sale
    const selectSale = (sale: Sale) => {
        setSelectedSale(sale);
        setReturnItems([]);
        setRefundMethod(sale.payment_method);
        setSearchTerm('');
    };

    // Create return mutation
    const createReturn = useMutation({
        mutationFn: (data: CreateReturnPayload & { idempotency_key: string }) =>
            client.post('/sales/returns/', data),
        onSuccess: () => {
            toast.success(t('ReturnCreated'));
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['recentSales'] });
            clearOperationAttempt(RETURN_CREATION_ATTEMPT_STORAGE_KEY);
            setReturnAttempt(null);
            resetForm();
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('ReturnCreateFailed')));
        }
    });

    // Approve return
    const approveReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/approve/`),
        onSuccess: () => {
            toast.success(t('ReturnApproved'));
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['stock'] });
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('ReturnApprovalFailed')));
        },
    });

    // Reject return
    const rejectReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/reject/`),
        onSuccess: () => {
            toast.success(t('ReturnRejected'));
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('ReturnRejectionFailed')));
        },
    });

    // Complete return
    const completeReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/complete/`),
        onSuccess: () => {
            toast.success(t('ReturnCompleted'));
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['credits'] });
            queryClient.invalidateQueries({ queryKey: ['credit-detail'] });
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('ReturnRefundFailed')));
        },
    });

    const resetForm = () => {
        setSelectedSale(null);
        setReturnItems([]);
        setReason('');
        setRefundMethod('CASH');
        setSearchTerm('');
        setShowCreateForm(false);
    };

    const toggleItem = (saleItemId: number, maxQty: number) => {
        const existing = returnItems.find(i => i.saleItemId === saleItemId);
        if (existing) {
            setReturnItems(returnItems.filter(i => i.saleItemId !== saleItemId));
        } else {
            setReturnItems([...returnItems, { saleItemId, quantity: maxQty, restock: true }]);
        }
    };

    const updateItemQty = (saleItemId: number, qty: number, maxQty: number) => {
        const safeQty = Number.isFinite(qty) ? Math.max(1, Math.min(qty, maxQty)) : 1;
        setReturnItems(returnItems.map(i =>
            i.saleItemId === saleItemId
                ? { ...i, quantity: safeQty }
                : i
        ));
    };

    const updateItemRestock = (saleItemId: number, restock: boolean) => {
        setReturnItems(returnItems.map(i =>
            i.saleItemId === saleItemId ? { ...i, restock } : i
        ));
    };

    const handleSubmitReturn = () => {
        if (!selectedSale || returnItems.length === 0 || !reason.trim()) {
            toast.error(t('SelectReturnItemsReason'));
            return;
        }
        const payload: CreateReturnPayload = {
            sale: selectedSale.id,
            reason,
            refund_method: selectedSale.payment_method === 'CREDIT' ? 'CREDIT' : refundMethod,
            items: returnItems.map(i => ({
                sale_item: i.saleItemId,
                quantity: i.quantity,
                restock: i.restock,
            })),
        };
        const fingerprint = operationFingerprint(['return-create', payload]);
        const attempt = getOrCreateOperationAttempt(
            fingerprint,
            loadOperationAttempt(RETURN_CREATION_ATTEMPT_STORAGE_KEY) ?? returnAttempt,
        );
        persistOperationAttempt(RETURN_CREATION_ATTEMPT_STORAGE_KEY, attempt);
        setReturnAttempt(attempt);
        createReturn.mutate({ ...payload, idempotency_key: attempt.key });
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            PENDING: 'badge-warning',
            APPROVED: 'badge-info',
            REJECTED: 'badge-danger',
            COMPLETED: 'badge-success'
        };
        return styles[status] || 'badge-secondary';
    };
    const isCreditSale = selectedSale?.payment_method === 'CREDIT';

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <RotateCcw className="text-accent" />
                        {t('Returns')}
                    </h1>
                    <p className="text-muted mt-1">{t('ReturnsSubtitle')}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="btn-primary flex items-center gap-2"
                    aria-expanded={showCreateForm}
                    aria-controls="return-create-form"
                >
                    <RotateCcw size={18} />
                    {t('NewReturn')}
                </button>
            </div>

            {/* Create Return Form */}
            {showCreateForm && (
                <div id="return-create-form" className="card p-6 border-accent border-2">
                    <h2 className="text-xl font-bold mb-4">{t('CreateReturn')}</h2>

                    {!selectedSale ? (
                        <>
                            {/* Search & Select Sale */}
                            <div className="mb-4">
                                <label htmlFor="return-sale-search" className="block text-sm font-medium mb-2">
                                    {t('SearchSaleForReturn')}
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                    <input
                                        id="return-sale-search"
                                        type="text"
                                        placeholder={t('SaleOrProductPlaceholder')}
                                        className="input pl-10 w-full"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Sales List */}
                            <div className="space-y-2 max-h-64 overflow-auto">
                                <p className="text-sm text-muted mb-2">
                                    {searchTerm ? t('SearchResultsFor', { search: searchTerm }) : t('RecentSales')}
                                </p>
                                {salesLoading ? (
                                    <p className="text-center text-muted py-4" role="status">{t('Loading')}</p>
                                ) : salesError ? (
                                    <div className="network-error-state" role="alert"><p>{t('SalesSearchFailed')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchSales()}>{t('Retry')}</button></div>
                                ) : filteredSales.length === 0 ? (
                                    <p className="text-center text-muted py-4">{t('NoSalesFound')}</p>
                                ) : (
                                    filteredSales.map(sale => (
                                        <button
                                            type="button"
                                            key={sale.id}
                                            onClick={() => selectSale(sale)}
                                            className="w-full p-3 border rounded-lg hover:border-accent hover:bg-accent-light transition-all text-left"
                                        >
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <span className="font-bold">{t('SaleNumber', { id: sale.id })}</span>
                                                    <div className="text-xs text-muted flex items-center gap-2 mt-1">
                                                        <Calendar size={12} />
                                                        {new Date(sale.created_at).toLocaleString(i18n.language)}
                                                    </div>
                                                </div>
                                                <span className="font-bold text-accent">{currency.format(sale.total_ttc)}</span>
                                            </div>
                                            <div className="mt-2 text-sm text-muted">
                                                {sale.items?.slice(0, 3).map(item => item.product_name).join(', ')}
                                                {sale.items?.length > 3 && t('MoreItems', { count: sale.items.length - 3 })}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Selected Sale */}
                            <div className="space-y-4">
                                <div className="p-4 bg-tertiary rounded-lg flex justify-between items-center">
                                    <div>
                                        <span className="font-bold">{t('SaleNumber', { id: selectedSale.id })}</span>
                                        <p className="text-sm text-muted">
                                            {new Date(selectedSale.created_at).toLocaleString(i18n.language)}
                                        </p>
                                        <p className="text-sm text-muted">
                                            {t('PaymentMethod')}: {paymentMethodLabels[selectedSale.payment_method]}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-accent font-bold">{currency.format(selectedSale.total_ttc)}</span>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSale(null)}
                                            className="btn-ghost text-sm"
                                        >
                                            {t('ChangeCustomer')}
                                        </button>
                                    </div>
                                </div>

                                {/* Items Selection */}
                                <div>
                                    <h3 className="font-medium mb-2">{t('SelectItemsToReturn')}</h3>
                                    <div className="space-y-2">
                                        {selectedSale.items?.map((item) => {
                                            const selected = returnItems.find(i => i.saleItemId === item.id);
                                            const returnableQuantity = Math.max(
                                                0,
                                                Number(item.returnable_quantity ?? item.quantity),
                                            );
                                            return (
                                                <div
                                                    key={item.id}
                                                    className={`p-3 rounded-lg border-2 transition-all ${selected ? 'border-accent bg-accent-light' : 'border-border hover:border-accent/50'}`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(selected)}
                                                                disabled={returnableQuantity === 0}
                                                                onChange={() => toggleItem(item.id, returnableQuantity)}
                                                                aria-label={t('ReturnNamedProduct', { product: item.product_name })}
                                                            />
                                                            <span className="font-medium">{item.product_name}</span>
                                                        </div>
                                                        <span className="text-sm text-muted">
                                                            {t('SoldAndReturnable', { sold: item.quantity, returnable: returnableQuantity })}
                                                        </span>
                                                    </div>
                                                    {selected && (
                                                        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <label htmlFor={`return-quantity-${item.id}`} className="text-sm">{t('QuantityToReturn')}</label>
                                                                <input
                                                                    id={`return-quantity-${item.id}`}
                                                                    type="number"
                                                                    min={1}
                                                                    max={returnableQuantity}
                                                                    value={selected.quantity}
                                                                    onChange={(e) => updateItemQty(item.id, parseInt(e.target.value), returnableQuantity)}
                                                                    className="input w-20 text-center"
                                                                />
                                                            </div>
                                                            <label className="flex items-center gap-2 text-sm" htmlFor={`return-restock-${item.id}`}>
                                                                <input
                                                                    id={`return-restock-${item.id}`}
                                                                    type="checkbox"
                                                                    checked={selected.restock}
                                                                    onChange={(e) => updateItemRestock(item.id, e.target.checked)}
                                                                />
                                                                {t('RestockSellable')}
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Refund method */}
                                <div>
                                    <label htmlFor="return-refund-method" className="block text-sm font-medium mb-2">
                                        {t('RefundMethod')}
                                    </label>
                                    <select
                                        id="return-refund-method"
                                        value={refundMethod}
                                        onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
                                        disabled={isCreditSale}
                                        aria-describedby={isCreditSale ? 'credit-return-refund-notice' : 'return-refund-method-hint'}
                                        className="input w-full"
                                    >
                                        {Object.entries(paymentMethodLabels).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                    {isCreditSale ? (
                                        <p id="credit-return-refund-notice" className="mt-2 rounded-lg border border-info/30 bg-info-light p-3 text-sm">
                                            {t('CreditSaleRefundNotice')}
                                        </p>
                                    ) : (
                                        <p id="return-refund-method-hint" className="mt-1 text-xs text-muted">
                                            {t('RefundMethodDefaultHint')}
                                        </p>
                                    )}
                                </div>

                                {/* Reason */}
                                <div>
                                    <label htmlFor="return-reason" className="block text-sm font-medium mb-2">{t('ReturnReason')} *</label>
                                    <textarea
                                        id="return-reason"
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        maxLength={2000}
                                        placeholder={t('ReturnReasonPlaceholder')}
                                        className="input w-full h-24 resize-none"
                                    />
                                </div>

                                {/* Info */}
                                <div className="p-3 bg-info-light rounded-lg border border-info/20 text-sm">
                                    <strong>{t('Notes')}:</strong> {t('ReturnWorkflowNotice')}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={handleSubmitReturn}
                                        disabled={returnItems.length === 0 || !reason.trim() || createReturn.isPending}
                                        className="btn-primary flex-1"
                                    >
                                        {createReturn.isPending ? t('Creating') : t('CreateReturn')}
                                    </button>
                                    <button type="button" onClick={resetForm} className="btn-secondary">
                                        {t('Cancel')}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Returns List */}
            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold">{t('ReturnHistory')}</h2>
                </div>
                <div className="divide-y">
                    {loadingReturns ? (
                        <div className="p-8 text-center text-muted" role="status">{t('Loading')}</div>
                    ) : returnsError ? (
                        <div className="network-error-state m-4" role="alert"><p>{t('ReturnsLoadFailed')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchReturns()}>{t('Retry')}</button></div>
                    ) : returns.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <RotateCcw size={48} className="mx-auto mb-4 opacity-50" />
                            <p>{t('NoReturns')}</p>
                        </div>
                    ) : (
                        returns.map((ret) => (
                            <div key={ret.id} className="p-4">
                                <button
                                    type="button"
                                    className="w-full flex flex-col gap-3 text-left bg-transparent p-0 sm:flex-row sm:items-center sm:justify-between"
                                    onClick={() => setExpandedReturn(expandedReturn === ret.id ? null : ret.id)}
                                    aria-expanded={expandedReturn === ret.id}
                                    aria-controls={`return-details-${ret.id}`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-tertiary rounded-full flex items-center justify-center">
                                            <RotateCcw size={20} className="text-muted" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{t('ReturnAndSaleNumber', { returnId: ret.id, saleId: ret.sale })}</p>
                                            <p className="text-sm text-muted">
                                                {new Date(ret.created_at).toLocaleString(i18n.language)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
                                        <span className={`badge ${getStatusBadge(ret.status)}`}>
                                            {returnStatusLabel(ret.status, ret.status_display || ret.status)}
                                        </span>
                                        <div className="text-right">
                                            <span className="block text-xs text-muted">{t('ReturnValue')}</span>
                                            <span className="block font-bold text-lg">{currency.format(ret.refund_amount)}</span>
                                            <span className="block text-xs text-muted">
                                                {t('CashRefundAmount')}: {currency.format(ret.cash_refund_amount ?? 0)}
                                            </span>
                                        </div>
                                        {expandedReturn === ret.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </button>

                                {/* Expanded Details */}
                                {expandedReturn === ret.id && (
                                    <div id={`return-details-${ret.id}`} className="mt-4 pl-14 space-y-3">
                                        <div className="p-3 bg-tertiary/50 rounded-lg">
                                            <p className="text-sm font-medium mb-1">{t('Reason')}:</p>
                                            <p className="text-muted">{ret.reason}</p>
                                            <p className="text-sm text-muted mt-2">
                                                {t('RefundMethod')}: {paymentMethodLabels[ret.refund_method] ?? ret.refund_method}
                                            </p>
                                        </div>

                                        <dl className="grid gap-3 sm:grid-cols-2">
                                            <div className="rounded-lg border border-border p-3">
                                                <dt className="text-xs text-muted">{t('ReturnValue')}</dt>
                                                <dd className="mt-1 font-semibold">{currency.format(ret.refund_amount)}</dd>
                                            </div>
                                            <div className="rounded-lg border border-border p-3">
                                                <dt className="text-xs text-muted">{t('CashRefundAmount')}</dt>
                                                <dd className="mt-1 font-semibold">{currency.format(ret.cash_refund_amount ?? 0)}</dd>
                                            </div>
                                        </dl>

                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">{t('ReturnedItems')}</p>
                                            {ret.items?.map((item) => (
                                                <div key={item.id} className="flex justify-between text-sm">
                                                    <span>
                                                        {item.quantity}x {item.product_name}
                                                        {' · '}{item.restock ? t('Restocked') : t('NotRestocked')}
                                                    </span>
                                                    <span className="text-muted">{currency.format(item.unit_price)}/u</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Action Buttons */}
                                        {ret.status === 'PENDING' && (
                                            <div className="flex gap-2 pt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (globalThis.confirm(t('ApproveReturnConfirmation'))) {
                                                            approveReturn.mutate(ret.id);
                                                        }
                                                    }}
                                                    disabled={approveReturn.isPending}
                                                    className="btn-success flex items-center gap-1 text-sm"
                                                >
                                                    <Check size={16} /> {t('Approve')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (globalThis.confirm(t('RejectReturnConfirmation'))) {
                                                            rejectReturn.mutate(ret.id);
                                                        }
                                                    }}
                                                    disabled={rejectReturn.isPending}
                                                    className="btn-danger flex items-center gap-1 text-sm"
                                                >
                                                    <X size={16} /> {t('Reject')}
                                                </button>
                                            </div>
                                        )}
                                        {ret.status === 'APPROVED' && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (globalThis.confirm(t('CompleteReturnConfirmation'))) {
                                                        completeReturn.mutate(ret.id);
                                                    }
                                                }}
                                                disabled={completeReturn.isPending}
                                                className="btn-primary flex items-center gap-1 text-sm"
                                            >
                                                <Check size={16} /> {t('MarkCompleted')}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
                {!loadingReturns && !returnsError && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        totalItems={returnsCount}
                        pageSize={PAGE_SIZE}
                        onPageChange={nextPage => { setExpandedReturn(null); setPage(nextPage); }}
                    />
                )}
            </div>
        </div>
    );
}
