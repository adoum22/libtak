import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    AlertCircle,
    Banknote,
    Calculator,
    CheckCircle2,
    Coins,
    CreditCard,
    History,
    Package,
    RotateCcw,
    Save,
    Wallet,
} from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastContext';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import { CASH_DENOMINATIONS, calculateDenominationTotal } from '../utils/cashRegister';
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
    CASH_REGISTER_COUNT_ATTEMPT_STORAGE_KEY,
    CASH_REGISTER_OPENING_ATTEMPT_STORAGE_KEY,
} from '../utils/privateSessionStorage';

interface CashAdjustment {
    id: number;
    adjustment_type: 'OPENING' | 'COUNT' | 'MANUAL';
    amount: number;
    counted_amount: number | null;
    note: string;
    created_by_name: string | null;
    created_at: string;
}

interface CashRegisterSummary {
    balance: number;
    opening_amount: number;
    cash_sales_total: number;
    credit_payments_total: number;
    returns_total: number;
    expenses_total: number;
    supplier_payments_total: number;
    adjustments_total: number;
    last_adjustment: CashAdjustment | null;
    recent_adjustments: CashAdjustment[];
}

const parseMoney = (value: string) => parseDecimalInput(value);

export default function CashRegister() {
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
    const formatMoney = currency.format;
    const adjustmentLabel = (type: CashAdjustment['adjustment_type']) => {
        if (type === 'OPENING') return t('OpeningFloat');
        if (type === 'COUNT') return t('PhysicalCount');
        return t('Adjustment');
    };
    const toast = useToast();
    const queryClient = useQueryClient();
    const [openingAmount, setOpeningAmount] = useState('');
    const [countedAmount, setCountedAmount] = useState('');
    const [note, setNote] = useState('');
    const [denominationCounts, setDenominationCounts] = useState<Record<string, string>>({});
    const [showCountConfirm, setShowCountConfirm] = useState(false);
    const [openingAttempt, setOpeningAttempt] = useState<OperationAttempt | null>(() => (
        loadOperationAttempt(CASH_REGISTER_OPENING_ATTEMPT_STORAGE_KEY)
    ));
    const [countAttempt, setCountAttempt] = useState<OperationAttempt | null>(() => (
        loadOperationAttempt(CASH_REGISTER_COUNT_ATTEMPT_STORAGE_KEY)
    ));

    const { data, isLoading, isError, refetch } = useQuery<CashRegisterSummary>({
        queryKey: ['cashRegister'],
        queryFn: () => client.get('/accounting/cash-register/').then(res => res.data),
    });

    const balance = data?.balance ?? 0;
    const counted = parseMoney(countedAmount);
    const countDelta = Number.isFinite(counted) ? counted - balance : 0;
    const denominationTotal = useMemo(
        () => calculateDenominationTotal(denominationCounts),
        [denominationCounts],
    );

    const stats = useMemo(() => [
        {
            label: t('OpeningFloat'),
            value: data?.opening_amount ?? 0,
            icon: Wallet,
            tone: 'accent',
        },
        {
            label: t('CashSales'),
            value: data?.cash_sales_total ?? 0,
            icon: Banknote,
            tone: 'success',
        },
        {
            label: t('CreditPaymentsIn'),
            value: data?.credit_payments_total ?? 0,
            icon: CreditCard,
            tone: 'accent',
        },
        {
            label: t('ExpensesOut'),
            value: data?.expenses_total ?? 0,
            icon: Calculator,
            tone: 'danger',
        },
        {
            label: t('RefundedReturns'),
            value: data?.returns_total ?? 0,
            icon: History,
            tone: 'warning',
        },
        {
            label: t('CashSuppliers'),
            value: data?.supplier_payments_total ?? 0,
            icon: Package,
            tone: 'warning',
        },
    ], [data, t]);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['cashRegister'] });

    const setOpeningMutation = useMutation({
        mutationFn: (payload: {
            action: 'set_opening';
            opening_amount: string;
            note: string;
            operation_id: string;
        }) => client.post('/accounting/cash-register/', payload),
        onSuccess: () => {
            setOpeningAmount('');
            setOpeningAttempt(null);
            clearOperationAttempt(CASH_REGISTER_OPENING_ATTEMPT_STORAGE_KEY);
            toast.success(t('OpeningFloatSaved'));
            refresh();
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('OpeningFloatSaveFailed')));
        },
    });

    const countMutation = useMutation({
        mutationFn: (payload: {
            action: 'count';
            counted_amount: string;
            note: string;
            operation_id: string;
        }) => client.post('/accounting/cash-register/', payload),
        onSuccess: () => {
            setCountedAmount('');
            setNote('');
            setDenominationCounts({});
            setShowCountConfirm(false);
            setCountAttempt(null);
            clearOperationAttempt(CASH_REGISTER_COUNT_ATTEMPT_STORAGE_KEY);
            toast.success(t('CashAdjusted'));
            refresh();
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, t('CashAdjustmentFailed')));
        },
    });

    const submitOpening = () => {
        const payload = {
            action: 'set_opening' as const,
            opening_amount: openingAmount,
            note: t('OpeningFloatDefaultNote'),
        };
        const attempt = getOrCreateOperationAttempt(
            operationFingerprint(['cash-register', payload]),
            loadOperationAttempt(CASH_REGISTER_OPENING_ATTEMPT_STORAGE_KEY) ?? openingAttempt,
        );
        setOpeningAttempt(attempt);
        persistOperationAttempt(CASH_REGISTER_OPENING_ATTEMPT_STORAGE_KEY, attempt);
        setOpeningMutation.mutate({ ...payload, operation_id: attempt.key });
    };

    const submitCount = () => {
        const payload = {
            action: 'count' as const,
            counted_amount: countedAmount,
            note: note.trim() || t('PhysicalCountDefaultNote'),
        };
        const attempt = getOrCreateOperationAttempt(
            operationFingerprint(['cash-register', payload]),
            loadOperationAttempt(CASH_REGISTER_COUNT_ATTEMPT_STORAGE_KEY) ?? countAttempt,
        );
        setCountAttempt(attempt);
        persistOperationAttempt(CASH_REGISTER_COUNT_ATTEMPT_STORAGE_KEY, attempt);
        countMutation.mutate({ ...payload, operation_id: attempt.key });
    };

    if (isLoading) {
        return <div className="text-center py-12 text-muted" role="status">{t('CashRegisterLoading')}</div>;
    }

    if (isError) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold">{t('CashRegister')}</h1>
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">{t('CashRegisterUnavailable')}</p>
                    <p className="text-sm mt-2">{t('CashRegisterUnavailableHint')}</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <Wallet className="text-accent" size={28} />
                        <h1 className="text-3xl font-bold">{t('CashRegister')}</h1>
                    </div>
                    <p className="text-muted">
                        {t('CashRegisterSubtitle')}
                    </p>
                </div>
                <div className="card px-6 py-4 min-w-[280px] border-t-4 border-t-accent">
                    <p className="text-sm text-muted uppercase font-semibold">{t('TheoreticalBalance')}</p>
                    <p className="text-4xl font-black text-accent mt-1">{formatMoney(balance)}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <div key={stat.label} className="stat-card">
                            <div className={`stat-icon bg-${stat.tone === 'danger' ? 'danger' : stat.tone === 'warning' ? 'warning' : stat.tone === 'success' ? 'success' : 'accent'}-light text-${stat.tone === 'danger' ? 'danger' : stat.tone === 'warning' ? 'warning' : stat.tone === 'success' ? 'success' : 'accent'}`}>
                                <Icon size={24} />
                            </div>
                            <div>
                                <p className="stat-label">{stat.label}</p>
                                <p className="stat-value">{formatMoney(stat.value)}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="card">
                    <div className="card-header flex items-center gap-3">
                        <Save className="text-accent" />
                        <div>
                            <h2 className="text-xl font-bold">{t('OpeningFloat')}</h2>
                            <p className="text-sm text-muted">{t('OpeningFloatHint', { amount: formatMoney(500) })}</p>
                        </div>
                    </div>
                    <div className="card-body space-y-4">
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">{t('InitialAmount')}</span>
                            <div className="flex rounded-xl border border-border bg-secondary focus-within:border-accent mt-2">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="money-input text-2xl font-bold py-3 pl-4 pr-3"
                                    placeholder="0.00"
                                    value={openingAmount}
                                    onChange={(event) => setOpeningAmount(normalizeDecimalInput(event.target.value))}
                                />
                                <span className="px-4 flex items-center text-muted font-bold border-l border-border">{currency.symbol}</span>
                            </div>
                        </label>
                        <button
                            type="button"
                            className="btn-primary w-full py-3 font-bold"
                            disabled={!Number.isFinite(parseMoney(openingAmount)) || parseMoney(openingAmount) < 0 || setOpeningMutation.isPending}
                            onClick={submitOpening}
                        >
                            <Save size={18} />
                            {t('SaveOpeningFloat')}
                        </button>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header flex items-center gap-3">
                        <Calculator className="text-accent" />
                        <div>
                            <h2 className="text-xl font-bold">{t('AdjustAfterCount')}</h2>
                            <p className="text-sm text-muted">{t('CountedAmountHint')}</p>
                        </div>
                    </div>
                    <div className="card-body space-y-4">
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">{t('ActualAmount')}</span>
                            <div className="flex rounded-xl border border-border bg-secondary focus-within:border-accent mt-2">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="money-input text-2xl font-bold py-3 pl-4 pr-3"
                                    placeholder="0.00"
                                    value={countedAmount}
                                    onChange={(event) => setCountedAmount(normalizeDecimalInput(event.target.value))}
                                />
                                <span className="px-4 flex items-center text-muted font-bold border-l border-border">{currency.symbol}</span>
                            </div>
                        </label>
                        <details className="rounded-xl border border-border bg-tertiary p-4">
                            <summary className="cursor-pointer font-semibold flex items-center gap-2">
                                <Coins size={18} className="text-accent" />
                                {t('CashDenominationCounter')}
                            </summary>
                            <p className="text-sm text-muted mt-2">{t('CashDenominationCounterHint')}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                                {CASH_DENOMINATIONS.map((denomination) => (
                                    <label key={denomination} className="block">
                                        <span className="text-xs font-semibold text-muted">{formatMoney(denomination)}</span>
                                        <input
                                            className="mt-1"
                                            type="number"
                                            inputMode="numeric"
                                            min="0"
                                            step="1"
                                            value={denominationCounts[String(denomination)] || ''}
                                            aria-label={t('CashDenominationQuantity', { amount: formatMoney(denomination) })}
                                            onChange={(event) => {
                                                const value = event.target.value.replace(/[^0-9]/g, '');
                                                setDenominationCounts((current) => ({
                                                    ...current,
                                                    [String(denomination)]: value,
                                                }));
                                            }}
                                        />
                                    </label>
                                ))}
                            </div>
                            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                                <div>
                                    <p className="text-xs text-muted uppercase font-semibold">{t('DenominationTotal')}</p>
                                    <p className="text-xl font-bold">{formatMoney(denominationTotal)}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() => setDenominationCounts({})}
                                        aria-label={t('ResetDenominationCounter')}
                                    >
                                        <RotateCcw size={17} />
                                        {t('Reset')}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={() => {
                                            setCountedAmount(denominationTotal.toFixed(2));
                                        }}
                                    >
                                        {t('UseDenominationTotal')}
                                    </button>
                                </div>
                            </div>
                        </details>
                        <div className={`p-4 rounded-xl flex items-center justify-between ${countDelta < 0 ? 'bg-danger-light text-danger' : 'bg-success-light text-success'}`}>
                            <span className="font-semibold">{t('DifferenceFromTheoretical')}</span>
                            <span className="text-2xl font-bold">{formatMoney(countDelta)}</span>
                        </div>
                        <input
                            aria-label={t('CountNote')}
                            type="text"
                            placeholder={t('OptionalNote')}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            maxLength={255}
                        />
                        <button
                            type="button"
                            className="btn-primary w-full py-3 font-bold"
                            disabled={!Number.isFinite(counted) || counted < 0 || countMutation.isPending}
                            onClick={() => setShowCountConfirm(true)}
                        >
                            <CheckCircle2 size={18} />
                            {t('AdjustCashRegister')}
                        </button>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header flex items-center gap-3">
                    <History className="text-accent" />
                    <h2 className="text-xl font-bold">{t('RecentAdjustments')}</h2>
                </div>
                <div className="card-body">
                    {isLoading ? (
                        <p className="text-muted text-center py-8">{t('Loading')}</p>
                    ) : !data?.recent_adjustments.length ? (
                        <div className="text-center py-10 text-muted">
                            <AlertCircle className="mx-auto mb-3" />
                            {t('NoCashAdjustments')}
                        </div>
                    ) : (
                        <>
                            <div className="cash-mobile-adjustments">
                                {data.recent_adjustments.map((adjustment) => (
                                    <div key={`mobile-${adjustment.id}`} className="mobile-detail-card">
                                        <div className="mobile-detail-card-header">
                                            <div>
                                                <h3>{adjustmentLabel(adjustment.adjustment_type)}</h3>
                                                <p>{new Date(adjustment.created_at).toLocaleString(i18n.language)}</p>
                                            </div>
                                            <strong className={adjustment.amount < 0 ? 'text-danger' : 'text-success'}>
                                                {adjustment.amount >= 0 ? '+' : ''}{formatMoney(adjustment.amount)}
                                            </strong>
                                        </div>
                                        <div className="mobile-money-grid">
                                            <div>
                                                <span>{t('Counted')}</span>
                                                <strong>{adjustment.counted_amount !== null ? formatMoney(adjustment.counted_amount) : '-'}</strong>
                                            </div>
                                            <div>
                                                <span>{t('User')}</span>
                                                <strong>{adjustment.created_by_name || '-'}</strong>
                                            </div>
                                        </div>
                                        {adjustment.note && <p className="mobile-note">{adjustment.note}</p>}
                                    </div>
                                ))}
                            </div>
                            <div className="overflow-x-auto">
                                <table>
                                <caption className="sr-only">{t('RecentAdjustmentsCaption')}</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">{t('Type')}</th>
                                        <th scope="col">{t('CountedAmount')}</th>
                                        <th scope="col">{t('Adjustment')}</th>
                                        <th scope="col">{t('Notes')}</th>
                                        <th scope="col">{t('User')}</th>
                                        <th scope="col">{t('Date')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.recent_adjustments.map((adjustment) => (
                                        <tr key={adjustment.id}>
                                            <td className="font-semibold">{adjustmentLabel(adjustment.adjustment_type)}</td>
                                            <td>{adjustment.counted_amount !== null ? formatMoney(adjustment.counted_amount) : '-'}</td>
                                            <td className={adjustment.amount < 0 ? 'text-danger font-bold' : 'text-success font-bold'}>
                                                {formatMoney(adjustment.amount)}
                                            </td>
                                            <td>{adjustment.note || '-'}</td>
                                            <td>{adjustment.created_by_name || '-'}</td>
                                            <td>{new Date(adjustment.created_at).toLocaleString(i18n.language)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
            <ConfirmDialog
                open={showCountConfirm}
                tone="primary"
                title={t('ConfirmCashCountTitle')}
                description={t('ConfirmCashCountDescription', {
                    theoretical: formatMoney(balance),
                    counted: formatMoney(counted),
                    difference: formatMoney(countDelta),
                })}
                confirmLabel={t('ConfirmCashCount')}
                busy={countMutation.isPending}
                onCancel={() => setShowCountConfirm(false)}
                onConfirm={submitCount}
            />
        </div>
    );
}
