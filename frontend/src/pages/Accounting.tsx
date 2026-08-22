import { useState, type KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
    Calculator, DollarSign, TrendingUp, TrendingDown,
    Plus, Trash2, ChevronLeft, ChevronRight, CalendarDays, CalendarRange,
    Receipt, Package,
} from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import PremiumChartTooltip from '../components/PremiumChartTooltip';
import ConfirmDialog from '../components/ConfirmDialog';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
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
    ACCOUNTING_CASHIER_EXPENSE_ATTEMPT_STORAGE_KEY,
    ACCOUNTING_EXPENSE_ATTEMPT_STORAGE_KEY,
    ACCOUNTING_WITHDRAWAL_ATTEMPT_STORAGE_KEY,
} from '../utils/privateSessionStorage';

const PIE_COLORS = ['#0f766e', '#0369a1', '#047857', '#b45309', '#b91c1c', '#115e59', '#475569', '#1d4ed8'];
const axisTick = { fontSize: 11, fill: 'var(--color-text-muted)' };
const gridStroke = 'var(--color-border-light)';

type AccountingTab = 'day' | 'week' | 'month' | 'year' | 'categories';
const ACCOUNTING_TABS: AccountingTab[] = ['day', 'week', 'month', 'year', 'categories'];

const categoryLabel = (entry: unknown) => {
    if (typeof entry === 'object' && entry !== null && 'category' in entry) {
        return String(entry.category);
    }
    return '';
};

const toLocalDateInputValue = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

interface Category { id: number; name: string; is_default: boolean; }
interface Expense {
    id: number; category: number; category_name: string;
    amount: string | number; description: string; incurred_on: string | null;
    paid_from_cash: boolean;
}
interface MonthData {
    id: number; year: number; month: number;
    manager_withdrawal: string | number; notes: string;
    expenses: Expense[]; total_expenses: number;
    revenue: number;
    gross_margin?: number;
    net_profit: number;
    supplier_payments_total?: number;
    cash_after_withdrawal?: number;
    sales_margin_detail?: SalesMarginDetail;
}
interface YearSummary {
    year: number;
    months: Array<{
        month: number; label: string;
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
        supplier_payments?: number;
    }>;
    quarters: Array<{
        quarter: number; label: string;
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
        supplier_payments?: number;
    }>;
    category_breakdown: Array<{ category: string; total: number }>;
    sales_margin_detail?: SalesMarginDetail;
    totals: {
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
        supplier_payments?: number;
    };
}

interface SaleMarginRow {
    id: number;
    created_at: string;
    payment_method: string;
    items_count: number;
    revenue: number;
    gross_revenue: number;
    discount: number;
    purchase_cost: number;
    margin: number;
}

interface ProductMarginRow {
    product_id: number | null;
    product_name: string;
    quantity: number;
    revenue: number;
    discount: number;
    purchase_cost: number;
    margin: number;
}

interface SalesMarginDetail {
    sales: SaleMarginRow[];
    products: ProductMarginRow[];
}

interface PeriodSummary {
    type: 'day' | 'week';
    date: string;
    start_date: string;
    end_date: string;
    revenue: number;
    gross_margin: number;
    expenses: number;
    expenses_dated?: number;
    expenses_undated_share?: number;
    supplier_payments?: number;
    net_profit: number;
    expenses_detail: Expense[];
    category_breakdown: Array<{ category: string; total: number }>;
    daily: Array<{
        date: string;
        label: string;
        revenue: number;
        gross_margin: number;
        expenses: number;
        supplier_payments?: number;
        net_profit: number;
    }>;
    sales_margin_detail?: SalesMarginDetail;
}

export default function Accounting() {
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
    const locale = i18n.resolvedLanguage === 'ar'
        ? 'ar-MA'
        : i18n.resolvedLanguage === 'en'
            ? 'en-GB'
            : 'fr-FR';
    const monthNames = Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2024, index, 1)),
    );
    const toast = useToast();
    const qc = useQueryClient();
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [selectedDate, setSelectedDate] = useState(toLocalDateInputValue(now));
    const [tab, setTab] = useState<AccountingTab>('day');

    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: AccountingTab) => {
        const currentIndex = ACCOUNTING_TABS.indexOf(currentTab);
        let nextIndex: number | null = null;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = ACCOUNTING_TABS.length - 1;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            const visualDelta = event.key === 'ArrowRight' ? 1 : -1;
            const delta = document.documentElement.dir === 'rtl' ? -visualDelta : visualDelta;
            nextIndex = (currentIndex + delta + ACCOUNTING_TABS.length) % ACCOUNTING_TABS.length;
        }
        if (nextIndex == null) return;
        event.preventDefault();
        const nextTab = ACCOUNTING_TABS[nextIndex]!;
        setTab(nextTab);
        requestAnimationFrame(() => document.getElementById(`accounting-tab-${nextTab}`)?.focus());
    };
    const [cashierExpenseAttempt, setCashierExpenseAttempt] = useState<OperationAttempt | null>(() => (
        loadOperationAttempt(ACCOUNTING_CASHIER_EXPENSE_ATTEMPT_STORAGE_KEY)
    ));
    const [withdrawalAttempt, setWithdrawalAttempt] = useState<OperationAttempt | null>(() => (
        loadOperationAttempt(ACCOUNTING_WITHDRAWAL_ATTEMPT_STORAGE_KEY)
    ));
    const [expenseAttempt, setExpenseAttempt] = useState<OperationAttempt | null>(() => (
        loadOperationAttempt(ACCOUNTING_EXPENSE_ATTEMPT_STORAGE_KEY)
    ));
    const [deletionTarget, setDeletionTarget] = useState<
        { type: 'expense'; id: number } | { type: 'category'; id: number; name: string } | null
    >(null);
    const { data: currentUser, isLoading: currentUserLoading, isError: currentUserError, refetch: refetchCurrentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(r => r.data),
        retry: false,
        staleTime: 60_000,
    });
    const isAdmin = currentUser?.role === 'ADMIN';

    // ---------- Queries ----------
    const { data: categories = [], isError: categoriesError, refetch: refetchCategories } = useQuery<Category[]>({
        queryKey: ['acc-categories'],
        queryFn: async () => {
            const r = await client.get('/accounting/categories/');
            return r.data.results ?? r.data;
        },
        enabled: Boolean(currentUser),
    });

    const { data: monthData, isLoading: monthLoading, isError: monthIsError, refetch: refetchMonth } = useQuery<MonthData>({
        queryKey: ['acc-month', year, month],
        queryFn: () => client.get(`/accounting/monthly/by-period/${year}/${month}/`).then(r => r.data),
        enabled: isAdmin,
        staleTime: 0,
    });

    const { data: summary, isLoading: summaryLoading, isError: summaryIsError, refetch: refetchSummary } = useQuery<YearSummary>({
        queryKey: ['acc-summary', year],
        queryFn: () => client.get(`/accounting/summary/?year=${year}`).then(r => r.data),
        enabled: isAdmin,
        staleTime: 0,
    });

    const { data: periodSummary, isLoading: periodLoading, isError: periodIsError, refetch: refetchPeriod } = useQuery<PeriodSummary>({
        queryKey: ['acc-period', tab, selectedDate],
        queryFn: () => client
            .get(`/accounting/period-summary/?type=${tab === 'week' ? 'week' : 'day'}&date=${selectedDate}`)
            .then(r => r.data),
        enabled: isAdmin && (tab === 'day' || tab === 'week'),
        retry: 1,
        staleTime: 0,
    });

    // ---------- Mutations ----------
    const saveMonthly = useMutation({
        mutationFn: (payload: { notes: string }) =>
            client.patch(`/accounting/monthly/${monthData!.id}/`, payload),
        onSuccess: () => {
            toast.success(t('AccountingMonthUpdated'));
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, t('AccountingSaveFailed'))),
    });

    const addWithdrawal = useMutation({
        mutationFn: async (payload: { amount: number; note: string; incurred_on: string; operation_id: string }) => {
            try {
                return await client.post(`/accounting/monthly/${monthData!.id}/withdraw/`, payload);
            } catch (error: unknown) {
                const statusCode = (error as { response?: { status?: number } })?.response?.status;
                if (statusCode !== 404) {
                    throw error;
                }

                let withdrawalCategory = categories.find(
                    category => category.name.trim().toLowerCase() === 'retrait gérant',
                );
                if (!withdrawalCategory) {
                    const created = await client.post('/accounting/categories/', { name: 'Retrait gérant' });
                    withdrawalCategory = created.data;
                }
                if (!withdrawalCategory) {
                    throw error;
                }

                return client.post('/accounting/expenses/', {
                    year,
                    month,
                    category: withdrawalCategory.id,
                    amount: payload.amount,
                    description: payload.note,
                    incurred_on: payload.incurred_on,
                    paid_from_cash: true,
                    operation_id: payload.operation_id,
                });
            }
        },
        onSuccess: () => {
            toast.success(t('AccountingWithdrawalRecorded'));
            setWithdrawalDraft({ amount: '', note: '' });
            setWithdrawalAttempt(null);
            clearOperationAttempt(ACCOUNTING_WITHDRAWAL_ATTEMPT_STORAGE_KEY);
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, t('AccountingWithdrawalFailed'))),
    });

    const addExpense = useMutation({
        mutationFn: (payload: { category: number; amount: number; description: string; paid_from_cash: boolean; incurred_on?: string; year?: number; month?: number; operation_id: string }) =>
            client.post('/accounting/expenses/', { ...payload, year: payload.year ?? year, month: payload.month ?? month }),
        onSuccess: () => {
            toast.success(t('AccountingExpenseAdded'));
            setNewExp({ category: '', amount: '', description: '', paid_from_cash: true });
            setExpenseAttempt(null);
            clearOperationAttempt(ACCOUNTING_EXPENSE_ATTEMPT_STORAGE_KEY);
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, t('AccountingExpenseAddFailed'))),
    });

    const addCashierExpense = useMutation({
        mutationFn: (payload: { category: number; amount: number; description: string; incurred_on: string; operation_id: string }) =>
            client.post('/accounting/cashier-expense/', payload),
        onSuccess: () => {
            toast.success(t('AccountingExpenseAdded'));
            setNewExp({ category: '', amount: '', description: '', paid_from_cash: true });
            setCashierExpenseAttempt(null);
            clearOperationAttempt(ACCOUNTING_CASHIER_EXPENSE_ATTEMPT_STORAGE_KEY);
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, t('AccountingExpenseAddFailed'))),
    });

    const deleteExpense = useMutation({
        mutationFn: (id: number) => client.delete(`/accounting/expenses/${id}/`),
        onSuccess: () => {
            setDeletionTarget(null);
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
    });

    const addCategory = useMutation({
        mutationFn: (name: string) => client.post('/accounting/categories/', { name }),
        onSuccess: () => {
            toast.success(t('AccountingCategoryCreated'));
            qc.invalidateQueries({ queryKey: ['acc-categories'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, t('AccountingCategoryCreateFailed'), 'name')),
    });

    const deleteCategory = useMutation({
        mutationFn: (id: number) => client.delete(`/accounting/categories/${id}/`),
        onSuccess: () => {
            setDeletionTarget(null);
            qc.invalidateQueries({ queryKey: ['acc-categories'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, t('DeleteFailed'))),
    });

    // ---------- Local form state ----------
    const [monthDraft, setMonthDraft] = useState({
        id: null as number | null,
        notes: '',
    });
    const [withdrawalDraft, setWithdrawalDraft] = useState({ amount: '', note: '' });
    const [newExp, setNewExp] = useState({ category: '', amount: '', description: '', paid_from_cash: true });
    const [newCatName, setNewCatName] = useState('');

    const currentMonthId = monthData?.id ?? null;
    const notes = monthData && monthDraft.id === monthData.id
        ? monthDraft.notes
        : (monthData?.notes ?? '');
    const setNotes = (value: string) => {
        setMonthDraft({ id: currentMonthId, notes: value });
    };

    const fmt = currency.format;
    const formatInputDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(locale);
    const cashierCategoryOptions = categories.map(category => ({
        value: String(category.id),
        label: category.name,
    }));

    const submitCashierExpense = () => {
        if (!newExp.category || !newExp.amount) {
            toast.error(t('AccountingChooseCategoryAndAmount'));
            return;
        }
        const amount = parseDecimalInput(newExp.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error(t('InvalidAmount'));
            return;
        }
        const payload = {
            category: Number(newExp.category),
            amount,
            description: newExp.description,
            incurred_on: selectedDate,
        };
        const attempt = getOrCreateOperationAttempt(
            operationFingerprint(['cashier-expense', payload]),
            loadOperationAttempt(ACCOUNTING_CASHIER_EXPENSE_ATTEMPT_STORAGE_KEY) ?? cashierExpenseAttempt,
        );
        setCashierExpenseAttempt(attempt);
        persistOperationAttempt(ACCOUNTING_CASHIER_EXPENSE_ATTEMPT_STORAGE_KEY, attempt);
        addCashierExpense.mutate({
            ...payload,
            operation_id: attempt.key,
        });
    };

    const submitWithdrawal = (payload: {
        amount: number;
        note: string;
        incurred_on: string;
    }) => {
        const attempt = getOrCreateOperationAttempt(
            operationFingerprint(['withdrawal', monthData?.id ?? null, year, month, payload]),
            loadOperationAttempt(ACCOUNTING_WITHDRAWAL_ATTEMPT_STORAGE_KEY) ?? withdrawalAttempt,
        );
        setWithdrawalAttempt(attempt);
        persistOperationAttempt(ACCOUNTING_WITHDRAWAL_ATTEMPT_STORAGE_KEY, attempt);
        addWithdrawal.mutate({
            ...payload,
            operation_id: attempt.key,
        });
    };

    const submitAdminExpense = (payload: {
        category: number;
        amount: number;
        description: string;
        paid_from_cash: boolean;
        incurred_on?: string;
        year?: number;
        month?: number;
    }) => {
        if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
            toast.error(t('InvalidAmount'));
            return;
        }
        const normalizedPayload = {
            ...payload,
            year: payload.year ?? year,
            month: payload.month ?? month,
        };
        const attempt = getOrCreateOperationAttempt(
            operationFingerprint(['expense', normalizedPayload]),
            loadOperationAttempt(ACCOUNTING_EXPENSE_ATTEMPT_STORAGE_KEY) ?? expenseAttempt,
        );
        setExpenseAttempt(attempt);
        persistOperationAttempt(ACCOUNTING_EXPENSE_ATTEMPT_STORAGE_KEY, attempt);
        addExpense.mutate({
            ...normalizedPayload,
            operation_id: attempt.key,
        });
    };

    const renderCashierExpenseEntry = () => (
        <div className="accounting-page cashier-expense-page space-y-6 animate-fadeIn">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Calculator size={26} /> {t('Expenses')}
                </h1>
                <p className="text-muted mt-1">
                    {t('AccountingSellerExpenseHelp')}
                </p>
            </div>

            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold text-lg">{t('NewExpense')}</h2>
                </div>
                <form
                    className="card-body space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        submitCashierExpense();
                    }}
                >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">{t('Date')}</span>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(event) => setSelectedDate(event.target.value)}
                                className="mt-2"
                            />
                        </label>
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">{t('Category')}</span>
                            <select
                                value={newExp.category}
                                onChange={(event) => setNewExp({ ...newExp, category: event.target.value })}
                                className="mt-2"
                            >
                                <option value="">{t('ChooseCategory')}</option>
                                {cashierCategoryOptions.map(category => (
                                    <option key={category.value} value={category.value}>{category.label}</option>
                                ))}
                            </select>
                            {cashierCategoryOptions.length === 0 && (
                                <p className="text-sm text-danger mt-2">
                                    {t('AccountingNoCategorySellerHelp')}
                                </p>
                            )}
                        </label>
                    </div>
                    <label className="block">
                        <span className="text-sm font-semibold text-muted">{t('AmountPaid')}</span>
                        <div className="flex rounded-xl border border-border bg-secondary focus-within:border-accent mt-2">
                            <input
                                type="text"
                                inputMode="decimal"
                                value={newExp.amount}
                                onChange={(event) => setNewExp({ ...newExp, amount: normalizeDecimalInput(event.target.value) })}
                                required
                                placeholder="0.00"
                                className="money-input text-2xl font-bold py-3 pl-4 pr-3"
                            />
                            <span className="px-4 flex items-center text-muted font-bold border-l border-border">{currency.symbol}</span>
                        </div>
                    </label>
                    <label className="block">
                        <span className="text-sm font-semibold text-muted">{t('Description')}</span>
                        <textarea
                            value={newExp.description}
                            onChange={(event) => setNewExp({ ...newExp, description: event.target.value })}
                            maxLength={255}
                            placeholder={t('AccountingExpenseDescriptionPlaceholder')}
                            className="mt-2"
                            rows={3}
                        />
                    </label>
                    <div className="rounded-xl bg-warning-light text-warning p-4 text-sm font-medium">
                        {t('AccountingExpenseDeductedFromCash')}
                    </div>
                    <button
                        type="submit"
                        disabled={addCashierExpense.isPending || cashierCategoryOptions.length === 0}
                        className="btn-primary w-full py-3 font-bold"
                    >
                        <Plus size={18} />
                        {t('RecordExpense')}
                    </button>
                </form>
            </div>
        </div>
    );

    // ---------- Render helpers ----------
    const renderSalesMarginDetail = (detail?: SalesMarginDetail) => {
        const sales = detail?.sales ?? [];
        const products = detail?.products ?? [];

        return (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="card">
                    <div className="card-header flex items-center gap-2">
                        <Receipt size={20} className="text-accent" />
                        <h2 className="font-semibold text-lg">{t('MarginPerSale')}</h2>
                    </div>
                    <div className="accounting-mobile-list">
                        {sales.length === 0 ? (
                            <div className="mobile-empty-card">{t('NoSalesForPeriod')}</div>
                        ) : sales.map(sale => (
                            <div key={`mobile-sale-${sale.id}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{t('SaleNumber', { id: sale.id })}</h3>
                                        <p>{new Date(sale.created_at).toLocaleString(locale)}</p>
                                    </div>
                                    <span className="badge badge-accent">{sale.items_count} art.</span>
                                </div>
                                <div className="mobile-money-grid">
                                    <div>
                                        <span>{t('RevenueShort')}</span>
                                        <strong>{fmt(sale.revenue)}</strong>
                                    </div>
                                    <div>
                                        <span>{t('Purchase')}</span>
                                        <strong>{fmt(sale.purchase_cost)}</strong>
                                    </div>
                                    <div>
                                        <span>{t('Margin')}</span>
                                        <strong className={sale.margin >= 0 ? 'text-success' : 'text-red-500'}>{fmt(sale.margin)}</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <caption className="sr-only">{t('SalesDetails')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Sale')}</th>
                                    <th scope="col">{t('Items')}</th>
                                    <th scope="col" className="text-right">{t('RevenueShort')}</th>
                                    <th scope="col" className="text-right">{t('Purchase')}</th>
                                    <th scope="col" className="text-right">{t('Discount')}</th>
                                    <th scope="col" className="text-right">{t('Margin')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sales.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center py-8 text-muted">{t('NoSalesForPeriod')}</td></tr>
                                ) : sales.map(sale => (
                                    <tr key={sale.id}>
                                        <td>
                                            <p className="font-medium">#{sale.id}</p>
                                            <p className="text-xs text-muted">
                                                {new Date(sale.created_at).toLocaleString(locale)}
                                            </p>
                                        </td>
                                        <td>{sale.items_count}</td>
                                        <td className="text-right">{fmt(sale.revenue)}</td>
                                        <td className="text-right">{fmt(sale.purchase_cost)}</td>
                                        <td className="text-right">{fmt(sale.discount)}</td>
                                        <td className={`text-right font-semibold ${sale.margin >= 0 ? 'text-success' : 'text-red-500'}`}>
                                            {fmt(sale.margin)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header flex items-center gap-2">
                        <Package size={20} className="text-accent" />
                        <h2 className="font-semibold text-lg">{t('SoldItems')}</h2>
                    </div>
                    <div className="accounting-mobile-list">
                        {products.length === 0 ? (
                            <div className="mobile-empty-card">{t('NoItemsSoldForPeriod')}</div>
                        ) : products.map(product => (
                            <div key={`mobile-product-${product.product_id ?? product.product_name}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{product.product_name}</h3>
                                        <p>{t('QuantitySold')}: {product.quantity}</p>
                                    </div>
                                    <span className="badge badge-accent">x{product.quantity}</span>
                                </div>
                                <div className="mobile-money-grid">
                                    <div>
                                        <span>{t('NetRevenueShort')}</span>
                                        <strong>{fmt(product.revenue)}</strong>
                                    </div>
                                    <div>
                                        <span>{t('Purchase')}</span>
                                        <strong>{fmt(product.purchase_cost)}</strong>
                                    </div>
                                    <div>
                                        <span>{t('Margin')}</span>
                                        <strong className={product.margin >= 0 ? 'text-success' : 'text-red-500'}>{fmt(product.margin)}</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <caption className="sr-only">{t('SoldItems')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Product')}</th>
                                    <th scope="col" className="text-right">{t('QtyShort')}</th>
                                    <th scope="col" className="text-right">{t('NetRevenueShort')}</th>
                                    <th scope="col" className="text-right">{t('Purchase')}</th>
                                    <th scope="col" className="text-right">{t('Margin')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.length === 0 ? (
                                    <tr><td colSpan={5} className="text-center py-8 text-muted">{t('NoItemsSoldForPeriod')}</td></tr>
                                ) : products.map(product => (
                                    <tr key={`${product.product_id ?? product.product_name}`}>
                                        <td className="font-medium">{product.product_name}</td>
                                        <td className="text-right font-semibold">{product.quantity}</td>
                                        <td className="text-right">{fmt(product.revenue)}</td>
                                        <td className="text-right">{fmt(product.purchase_cost)}</td>
                                        <td className={`text-right font-semibold ${product.margin >= 0 ? 'text-success' : 'text-red-500'}`}>
                                            {fmt(product.margin)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        );
    };

    const renderPeriodTab = () => {
        if (periodLoading) return <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>;
        if (periodIsError) {
            return (
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">{t('AccountingPeriodLoadFailed')}</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetchPeriod()}>{t('Retry')}</button>
                </div>
            );
        }
        if (!periodSummary) return <div className="text-center py-12 text-muted">{t('NoData')}</div>;

        const isWeek = tab === 'week';
        const periodLabel = isWeek
            ? t('DateRange', { start: formatInputDate(periodSummary.start_date), end: formatInputDate(periodSummary.end_date) })
            : formatInputDate(periodSummary.date);
        const dailyForChart = periodSummary.daily.map(day => ({
            ...day,
            label: new Date(`${day.date}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric' }),
        }));

        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="stat-card">
                        <div className="stat-icon bg-success-light"><DollarSign size={24} className="text-success" /></div>
                        <div><p className="stat-label">{t('RevenueShort')}</p><p className="stat-value">{fmt(periodSummary.revenue)}</p></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-blue-100"><TrendingUp size={24} className="text-blue-600" /></div>
                        <div><p className="stat-label">{t('GrossMargin')}</p><p className="stat-value">{fmt(periodSummary.gross_margin)}</p></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-red-100"><TrendingDown size={24} className="text-red-500" /></div>
                        <div>
                            <p className="stat-label">{t('Expenses')}</p>
                            <p className="stat-value">{fmt(periodSummary.expenses)}</p>
                            {(periodSummary.expenses_undated_share ?? 0) > 0 && (
                                <p className="text-xs text-muted" title={t('AccountingUndatedExpenseShareHelp')}>
                                    {t('AccountingIncludesDistributedAmount', { amount: fmt(periodSummary.expenses_undated_share || 0) })}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-accent-light"><TrendingUp size={24} className="text-accent" /></div>
                        <div>
                            <p className="stat-label">{t('NetProfit')}</p>
                            <p className={`stat-value ${periodSummary.net_profit >= 0 ? 'text-success' : 'text-red-500'}`}>
                                {fmt(periodSummary.net_profit)}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="card p-4 flex items-center gap-3 border-l-4 border-l-warning">
                    <Package size={22} className="text-warning" />
                    <div>
                        <p className="font-semibold">{t('SupplierPayments')}: {fmt(periodSummary.supplier_payments ?? 0)}</p>
                        <p className="text-xs text-muted">{t('AccountingSupplierPaymentsPeriodNotice')}</p>
                    </div>
                </div>

                {isWeek && (
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><CalendarRange size={18} /></span>
                            {t('ResultByDay')}
                        </h2>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
                                <BarChart role="img" data={dailyForChart} aria-label={t('ResultByDay')}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                                    <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                    <Legend />
                                    <Bar dataKey="revenue" name="CA" fill="#0f766e" radius={[8, 8, 3, 3]} maxBarSize={32} />
                                    <Bar dataKey="expenses" name={t('Expenses')} fill="#b91c1c" radius={[8, 8, 3, 3]} maxBarSize={32} />
                                    <Bar dataKey="net_profit" name={t('NetProfit')} fill="#0369a1" radius={[8, 8, 3, 3]} maxBarSize={32} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                <div className="card p-6">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                        <h2 className="text-lg font-semibold">{t('AddDatedExpense')}</h2>
                        <span className="text-sm text-muted">{periodLabel}</span>
                    </div>
                    <form
                        className="grid grid-cols-1 md:grid-cols-6 gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const dateParts = selectedDate.split('-').map(Number);
                            const payload = {
                                category: Number(newExp.category),
                                amount: parseDecimalInput(newExp.amount),
                                description: newExp.description,
                                paid_from_cash: newExp.paid_from_cash,
                                incurred_on: selectedDate,
                                year: dateParts[0],
                                month: dateParts[1],
                            };
                            submitAdminExpense(payload);
                            if (dateParts.length === 3) {
                                setYear(dateParts[0]);
                                setMonth(dateParts[1]);
                            }
                        }}
                    >
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Date')}</span>
                            <input
                                type="date"
                                required
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Category')}</span>
                            <select
                                required
                                value={newExp.category}
                                onChange={(e) => setNewExp({ ...newExp, category: e.target.value })}
                            >
                                <option value="">{t('CategoryEllipsis')}</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Amount')}</span>
                            <input
                                type="text" inputMode="decimal" placeholder="0.00"
                                value={newExp.amount}
                                onChange={(e) => setNewExp({ ...newExp, amount: normalizeDecimalInput(e.target.value) })}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Description')}</span>
                            <input
                                type="text" placeholder={t('Optional')}
                                value={newExp.description}
                                onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
                                maxLength={255}
                            />
                        </label>
                        <label className="self-end flex items-center gap-2 px-3 py-2 bg-tertiary/40 rounded-lg text-sm font-medium">
                            <input
                                type="checkbox"
                                checked={newExp.paid_from_cash}
                                onChange={(e) => setNewExp({ ...newExp, paid_from_cash: e.target.checked })}
                                className="w-4 h-4"
                            />
                            {t('CashOutflow')}
                        </label>
                        <button
                            type="submit"
                            className="btn-primary self-end flex items-center justify-center gap-2"
                            disabled={!newExp.category || !newExp.amount || addExpense.isPending}
                        >
                            <Plus size={18} /> {t('Add')}
                        </button>
                    </form>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h2 className="font-semibold text-lg">{t('PeriodExpenses')}</h2>
                    </div>
                    <div className="accounting-mobile-list">
                        {periodSummary.expenses_detail.length === 0 ? (
                            <div className="mobile-empty-card">{t('NoExpenses')}</div>
                        ) : periodSummary.expenses_detail.map(e => (
                            <div key={`mobile-period-expense-${e.id}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{e.description || e.category_name}</h3>
                                        <p>{e.incurred_on ? formatInputDate(e.incurred_on) : t('NoDate')} · {e.category_name}</p>
                                    </div>
                                    <strong>{fmt(Number(e.amount))}</strong>
                                </div>
                                <div className="mobile-detail-actions">
                                    <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                        {t('CashRegister')}: {e.paid_from_cash ? t('Yes') : t('No')}
                                    </span>
                                    <button
                                        onClick={() => setDeletionTarget({ type: 'expense', id: e.id })}
                                        className="btn-ghost btn-icon text-red-500"
                                        title={t('Delete')}
                                        aria-label={t('DeleteExpense')}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <caption className="sr-only">{t('PeriodExpenses')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Date')}</th>
                                    <th scope="col">{t('Category')}</th>
                                    <th scope="col">{t('Description')}</th>
                                    <th scope="col">{t('CashRegister')}</th>
                                    <th scope="col" className="text-right">{t('Amount')}</th>
                                    <th scope="col"><span className="sr-only">{t('Actions')}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {periodSummary.expenses_detail.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center py-8 text-muted">{t('NoExpenses')}</td></tr>
                                ) : periodSummary.expenses_detail.map(e => (
                                    <tr key={e.id}>
                                        <td>{e.incurred_on ? formatInputDate(e.incurred_on) : '-'}</td>
                                        <td><span className="badge badge-accent">{e.category_name}</span></td>
                                        <td>{e.description || '-'}</td>
                                        <td>
                                            <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                                {e.paid_from_cash ? t('Yes') : t('No')}
                                            </span>
                                        </td>
                                        <td className="text-right">{fmt(Number(e.amount))}</td>
                                        <td className="text-right">
                                            <button
                                                onClick={() => setDeletionTarget({ type: 'expense', id: e.id })}
                                                className="btn-ghost btn-icon text-red-500"
                                                title={t('Delete')}
                                                aria-label={t('DeleteExpense')}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {renderSalesMarginDetail(periodSummary.sales_margin_detail)}
            </div>
        );
    };

    const renderMonthTab = () => {
        if (monthLoading) return <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>;
        if (monthIsError) return (
            <div className="network-error-state" role="alert">
                <p className="font-semibold">{t('AccountingMonthlyDataUnavailable')}</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void refetchMonth()}>{t('Retry')}</button>
            </div>
        );
        if (!monthData) return <div className="text-center py-12 text-muted">{t('NoDataForMonth')}</div>;

        const revenue = monthData.revenue ?? 0;
        const totalExp = monthData.total_expenses ?? 0;
        const wd = Number(monthData.manager_withdrawal) || 0;
        // Source de vérité = backend (gross_margin = vente - achat).
        // Fallback safe si l'API ancienne ne renvoie pas le champ.
        const grossMargin = monthData.gross_margin ?? (monthData.net_profit + totalExp);
        const cogs = Math.max(0, revenue - grossMargin);
        const net = monthData.net_profit ?? (grossMargin - totalExp);
        const cashAfter = monthData.cash_after_withdrawal ?? net;
        const withdrawalAmount = parseDecimalInput(withdrawalDraft.amount);
        const canAddWithdrawal = Number.isFinite(withdrawalAmount) && withdrawalAmount > 0;
        const monthExpenseDate = toLocalDateInputValue(new Date(
            year,
            month - 1,
            Math.min(now.getDate(), new Date(year, month, 0).getDate()),
        ));

        // Données de waterfall pour visualiser : CA -> -achat -> -dépenses -> bénéfice
        const waterfall = [
            { name: 'CA', value: revenue, fill: '#047857' },
            { name: t('PurchaseCost'), value: cogs, fill: '#b45309' },
            { name: t('GrossMargin'), value: grossMargin, fill: '#1d4ed8' },
            { name: t('Expenses'), value: totalExp, fill: '#b91c1c' },
            { name: t('NetProfit'), value: Math.max(0, net), fill: '#1e40af' },
        ];

        // Catégories de dépenses du mois (pour pie)
        const byCat: Record<string, number> = {};
        monthData.expenses.forEach(e => {
            byCat[e.category_name] = (byCat[e.category_name] || 0) + Number(e.amount);
        });
        const catData = Object.entries(byCat).map(([category, total]) => ({ category, total }));

        return (
            <div className="space-y-6">
                {/* KPI cards — 4 horizontales comme l'onglet Annuel */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="stat-card">
                        <div className="stat-icon bg-success-light"><DollarSign size={24} className="text-success" /></div>
                        <div>
                            <p className="stat-label">{t('Revenue')}</p>
                            <p className="stat-value">{fmt(revenue)}</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-blue-100"><TrendingUp size={24} className="text-blue-600" /></div>
                        <div>
                            <p className="stat-label">{t('GrossMargin')}</p>
                            <p className="stat-value">{fmt(grossMargin)}</p>
                            <p className="text-xs text-muted">{t('SaleMinusPurchase')}</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-red-100"><TrendingDown size={24} className="text-red-500" /></div>
                        <div>
                            <p className="stat-label">{t('Expenses')}</p>
                            <p className="stat-value">{fmt(totalExp)}</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-accent-light"><TrendingUp size={24} className="text-accent" /></div>
                        <div>
                            <p className="stat-label">{t('NetProfit')}</p>
                            <p className={`stat-value ${net >= 0 ? 'text-success' : 'text-red-500'}`}>{fmt(net)}</p>
                            <p className="text-xs text-muted">{t('MarginMinusExpenses')}</p>
                        </div>
                    </div>
                </div>

                <div className="card p-4 flex items-center gap-3 border-l-4 border-l-warning">
                    <Package size={22} className="text-warning" />
                    <div>
                        <p className="font-semibold">{t('MonthlySupplierPayments')}: {fmt(monthData.supplier_payments_total ?? 0)}</p>
                        <p className="text-xs text-muted">{t('AccountingMonthlySupplierPaymentsNotice')}</p>
                    </div>
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Décomposition CA -> Bénéfice */}
                    <div className="card chart-card p-6 lg:col-span-2">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingUp size={18} /></span>
                            {t('ResultBreakdown')}
                        </h2>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
                                <BarChart role="img" data={waterfall} aria-label={t('ResultBreakdown')}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                                    <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                    <Bar dataKey="value" name={t('Amount')} radius={[10, 10, 4, 4]} maxBarSize={48}>
                                        {waterfall.map(d => (
                                            <Cell key={d.name} fill={d.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Pie dépenses */}
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingDown size={18} /></span>
                            {t('ExpensesByCategory')}
                        </h2>
                        <div className="h-[280px] w-full">
                            {catData.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    {t('NoExpensesThisMonth')}
                                </div>
                            ) : (
                                <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
                                    <PieChart role="img" aria-label={t('ExpensesByCategory')}>
                                        <Pie
                                            data={catData} dataKey="total" nameKey="category"
                                            cx="50%" cy="50%" innerRadius={52} outerRadius={90}
                                            paddingAngle={2}
                                            label={categoryLabel}
                                        >
                                            {catData.map((row, i) => (
                                                <Cell key={row.category ?? i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Withdrawal + notes form */}
                <div className="card p-6">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                        <h2 className="text-lg font-semibold">{t('MonthlyEntry')}</h2>
                        <div className="text-sm text-muted">
                            {t('ManagerWithdrawal')}: <span className="font-semibold text-warning">{fmt(wd)}</span>
                            <span className="mx-2">•</span>
                            {t('RemainingAfterWithdrawal')}: <span className={`font-semibold ${cashAfter >= 0 ? 'text-success' : 'text-red-500'}`}>{fmt(cashAfter)}</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <form
                            className="rounded-xl border border-border p-4 bg-tertiary/20"
                            onSubmit={(event) => {
                                event.preventDefault();
                                submitWithdrawal({
                                    amount: withdrawalAmount,
                                    note: withdrawalDraft.note.trim() || t('ManagerWithdrawal'),
                                    incurred_on: monthExpenseDate,
                                });
                            }}
                        >
                            <label htmlFor="monthly-withdrawal-amount" className="block text-sm font-medium mb-1">{t('NewWithdrawal')} ({currency.symbol})</label>
                            <input
                                id="monthly-withdrawal-amount"
                                type="text" inputMode="decimal"
                                value={withdrawalDraft.amount}
                                onChange={(e) => setWithdrawalDraft({ ...withdrawalDraft, amount: normalizeDecimalInput(e.target.value) })}
                                placeholder="0.00"
                            />
                            <label htmlFor="monthly-withdrawal-note" className="block text-sm font-medium mt-3 mb-1">{t('WithdrawalNote')}</label>
                            <input
                                id="monthly-withdrawal-note"
                                type="text"
                                value={withdrawalDraft.note}
                                onChange={(e) => setWithdrawalDraft({ ...withdrawalDraft, note: e.target.value })}
                                maxLength={255}
                                placeholder={t('CashWithdrawal')}
                            />
                            <button
                                type="submit"
                                className="btn-primary mt-4 w-full"
                                disabled={!canAddWithdrawal || addWithdrawal.isPending}
                            >
                                {t('AddWithdrawal')}
                            </button>
                        </form>
                        <form
                            className="rounded-xl border border-border p-4 bg-tertiary/20"
                            onSubmit={(event) => {
                                event.preventDefault();
                                saveMonthly.mutate({ notes });
                            }}
                        >
                            <label htmlFor="monthly-accounting-notes" className="block text-sm font-medium mb-1">{t('Notes')}</label>
                            <input
                                id="monthly-accounting-notes"
                                type="text" value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t('Optional')}
                            />
                            <button
                                type="submit"
                                className="btn-secondary mt-4 w-full"
                                disabled={saveMonthly.isPending}
                            >
                                {t('SaveNote')}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Add expense */}
                <div className="card p-6">
                    <h2 className="text-lg font-semibold mb-4">{t('AddExpense')}</h2>
                    <form
                        className="grid grid-cols-1 md:grid-cols-5 gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            submitAdminExpense({
                                category: Number(newExp.category),
                                amount: parseDecimalInput(newExp.amount),
                                description: newExp.description,
                                paid_from_cash: newExp.paid_from_cash,
                                year,
                                month,
                            });
                        }}
                    >
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Category')}</span>
                            <select
                                value={newExp.category}
                                onChange={(e) => setNewExp({ ...newExp, category: e.target.value })}
                            >
                                <option value="">{t('CategoryEllipsis')}</option>
                                {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Amount')}</span>
                            <input
                                type="text" inputMode="decimal" placeholder="0.00"
                                value={newExp.amount}
                                onChange={(e) => setNewExp({ ...newExp, amount: normalizeDecimalInput(e.target.value) })}
                            />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                            <span>{t('Description')}</span>
                            <input
                                type="text" placeholder={t('Optional')}
                                value={newExp.description}
                                onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
                                maxLength={255}
                            />
                        </label>
                        <label className="self-end flex items-center gap-2 px-3 py-2 bg-tertiary/40 rounded-lg text-sm font-medium">
                            <input
                                type="checkbox"
                                checked={newExp.paid_from_cash}
                                onChange={(e) => setNewExp({ ...newExp, paid_from_cash: e.target.checked })}
                                className="w-4 h-4"
                            />
                            {t('CashOutflow')}
                        </label>
                        <button
                            type="submit"
                            className="btn-primary self-end flex items-center justify-center gap-2"
                            disabled={!newExp.category || !newExp.amount || addExpense.isPending}
                        >
                            <Plus size={18} /> {t('Add')}
                        </button>
                    </form>
                </div>

                {/* Expense list */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="font-semibold text-lg">{t('MonthlyExpenses')}</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <caption className="sr-only">{t('MonthlyExpenses')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Category')}</th>
                                    <th scope="col">{t('Description')}</th>
                                    <th scope="col">{t('CashRegister')}</th>
                                    <th scope="col" className="text-right">{t('Amount')}</th>
                                    <th scope="col"><span className="sr-only">{t('Actions')}</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {monthData.expenses.length === 0 ? (
                                    <tr><td colSpan={5} className="text-center py-8 text-muted">{t('NoExpenses')}</td></tr>
                                ) : monthData.expenses.map(e => (
                                    <tr key={e.id}>
                                        <td><span className="badge badge-accent">{e.category_name}</span></td>
                                        <td>{e.description || '—'}</td>
                                        <td>
                                            <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                                {e.paid_from_cash ? t('Yes') : t('No')}
                                            </span>
                                        </td>
                                        <td className="text-right">{fmt(Number(e.amount))}</td>
                                        <td className="text-right">
                                            <button
                                                onClick={() => setDeletionTarget({ type: 'expense', id: e.id })}
                                                className="btn-ghost btn-icon text-red-500"
                                                title={t('Delete')}
                                                aria-label={t('DeleteExpense')}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="accounting-mobile-list accounting-mobile-expenses-only">
                    {monthData.expenses.length === 0 ? (
                        <div className="mobile-empty-card">{t('NoExpenses')}</div>
                    ) : monthData.expenses.map(e => (
                        <div key={`mobile-month-expense-${e.id}`} className="mobile-detail-card">
                            <div className="mobile-detail-card-header">
                                <div>
                                    <h3>{e.description || e.category_name}</h3>
                                    <p>{e.category_name}</p>
                                </div>
                                <strong>{fmt(Number(e.amount))}</strong>
                            </div>
                            <div className="mobile-detail-actions">
                                <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                    {t('CashRegister')}: {e.paid_from_cash ? t('Yes') : t('No')}
                                </span>
                                <button
                                    onClick={() => setDeletionTarget({ type: 'expense', id: e.id })}
                                    className="btn-ghost btn-icon text-red-500"
                                    title={t('Delete')}
                                    aria-label={t('DeleteExpense')}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {renderSalesMarginDetail(monthData.sales_margin_detail)}
            </div>
        );
    };

    const renderYearTab = () => {
        if (summaryLoading) return <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>;
        if (summaryIsError) return (
            <div className="network-error-state" role="alert">
                <p className="font-semibold">{t('AccountingAnnualSummaryUnavailable')}</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void refetchSummary()}>{t('Retry')}</button>
            </div>
        );
        if (!summary) return <div className="text-center py-12 text-muted">{t('NoDataForYear')}</div>;
        const localizedMonths = summary.months.map(item => ({
            ...item,
            label: monthNames[item.month - 1],
        }));
        return (
            <div className="space-y-6">
                {/* Year totals */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="stat-card"><div className="stat-icon bg-success-light"><DollarSign size={24} className="text-success" /></div>
                        <div><p className="stat-label">{t('AnnualRevenue')}</p><p className="stat-value">{fmt(summary.totals.revenue)}</p></div></div>
                    <div className="stat-card"><div className="stat-icon bg-warning-light"><TrendingDown size={24} className="text-warning" /></div>
                        <div><p className="stat-label">{t('ManagerWithdrawals')}</p><p className="stat-value">{fmt(summary.totals.manager_withdrawal)}</p></div></div>
                    <div className="stat-card"><div className="stat-icon bg-red-100"><TrendingDown size={24} className="text-red-500" /></div>
                        <div><p className="stat-label">{t('Expenses')}</p><p className="stat-value">{fmt(summary.totals.expenses)}</p></div></div>
                    <div className="stat-card"><div className="stat-icon bg-accent-light"><TrendingUp size={24} className="text-accent" /></div>
                        <div><p className="stat-label">{t('AnnualNetProfit')}</p>
                            <p className={`stat-value ${summary.totals.net_profit >= 0 ? 'text-success' : 'text-red-500'}`}>{fmt(summary.totals.net_profit)}</p></div></div>
                </div>

                <div className="card p-4 flex items-center gap-3 border-l-4 border-l-warning">
                    <Package size={22} className="text-warning" />
                    <div>
                        <p className="font-semibold">{t('AnnualSupplierPayments')}: {fmt(summary.totals.supplier_payments ?? 0)}</p>
                        <p className="text-xs text-muted">{t('AccountingAnnualSupplierPaymentsNotice')}</p>
                    </div>
                </div>

                {/* Quarter cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {summary.quarters.map(q => (
                        <div key={q.quarter} className="card p-4">
                            <p className="text-sm text-muted">{t('QuarterNumber', { number: q.quarter })}</p>
                            <p className="text-xl font-bold">{fmt(q.net_profit)}</p>
                            <p className="text-xs text-muted mt-1">{t('RevenueShort')}: {fmt(q.revenue)} • {t('ExpensesShort')}: {fmt(q.expenses)}</p>
                        </div>
                    ))}
                </div>

                {/* Chart 1: Revenue vs Expenses (bar) */}
                <div className="card chart-card p-6">
                    <h2 className="chart-title mb-4">
                        <span className="chart-title-icon"><DollarSign size={18} /></span>
                        {t('RevenueVsExpenses')}
                    </h2>
                    <div className="h-[320px] w-full">
                        <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
                            <BarChart role="img" data={localizedMonths} aria-label={t('RevenueVsExpenses')}>
                                <CartesianGrid stroke={gridStroke} vertical={false} />
                                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${v}`} />
                                <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                <Legend />
                                <Bar dataKey="revenue" name={t('Revenue')} fill="#047857" radius={[8, 8, 3, 3]} maxBarSize={34} />
                                <Bar dataKey="expenses" name={t('Expenses')} fill="#b91c1c" radius={[8, 8, 3, 3]} maxBarSize={34} />
                                <Bar dataKey="manager_withdrawal" name={t('ManagerWithdrawal')} fill="#b45309" radius={[8, 8, 3, 3]} maxBarSize={34} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Chart 2: Expense breakdown (pie) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingDown size={18} /></span>
                            {t('ExpensesByCategory')}
                        </h2>
                        <div className="h-[320px] w-full">
                            {summary.category_breakdown.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted">{t('NoExpensesRecorded')}</div>
                            ) : (
                                <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
                                    <PieChart role="img" aria-label={t('ExpensesByCategory')}>
                                        <Pie
                                            data={summary.category_breakdown}
                                            dataKey="total" nameKey="category"
                                            cx="50%" cy="50%" innerRadius={62} outerRadius={110}
                                            paddingAngle={2}
                                            label={categoryLabel}
                                        >
                                            {summary.category_breakdown.map((row, i: number) => (
                                                <Cell key={row.category ?? i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Chart 3: Net profit trend (line) */}
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingUp size={18} /></span>
                            {t('MonthlyNetProfit')}
                        </h2>
                        <div className="h-[320px] w-full">
                            <ResponsiveContainer initialDimension={{ width: 1, height: 1 }}>
                                <LineChart role="img" data={localizedMonths} aria-label={t('MonthlyNetProfit')}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                                    <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} cursor={{ stroke: 'var(--color-accent)', strokeOpacity: 0.18 }} />
                                    <Line
                                        type="monotone"
                                        dataKey="net_profit"
                                        name={t('NetProfit')}
                                        stroke="#0f766e"
                                        strokeWidth={3}
                                        dot={{ r: 4, strokeWidth: 2, fill: 'var(--color-bg-secondary)' }}
                                        activeDot={{ r: 6, strokeWidth: 3, stroke: 'var(--color-bg-secondary)' }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Monthly table */}
                <div className="card">
                    <div className="card-header"><h2 className="font-semibold text-lg">{t('MonthlyDetailForYear', { year })}</h2></div>
                    <div className="accounting-mobile-list">
                        {localizedMonths.map(m => (
                            <div key={`mobile-year-${m.month}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{m.label}</h3>
                                        <p>{t('Withdrawal')}: {fmt(m.manager_withdrawal)}</p>
                                    </div>
                                    <strong className={m.net_profit >= 0 ? 'text-success' : 'text-red-500'}>
                                        {fmt(m.net_profit)}
                                    </strong>
                                </div>
                                <div className="mobile-money-grid">
                                    <div>
                                        <span>{t('RevenueShort')}</span>
                                        <strong>{fmt(m.revenue)}</strong>
                                    </div>
                                    <div>
                                        <span>{t('Expenses')}</span>
                                        <strong>{fmt(m.expenses)}</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <caption className="sr-only">{t('MonthlyDetailForYear', { year })}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Month')}</th>
                                    <th scope="col" className="text-right">{t('RevenueShort')}</th>
                                    <th scope="col" className="text-right">{t('Withdrawal')}</th>
                                    <th scope="col" className="text-right">{t('Expenses')}</th>
                                    <th scope="col" className="text-right">{t('NetProfit')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {localizedMonths.map(m => (
                                    <tr key={m.month}>
                                        <td className="font-medium">
                                            <button className="text-accent hover:underline" onClick={() => { setMonth(m.month); setTab('month'); }}>
                                                {m.label}
                                            </button>
                                        </td>
                                        <td className="text-right">{fmt(m.revenue)}</td>
                                        <td className="text-right">{fmt(m.manager_withdrawal)}</td>
                                        <td className="text-right">{fmt(m.expenses)}</td>
                                        <td className={`text-right font-medium ${m.net_profit >= 0 ? 'text-success' : 'text-red-500'}`}>
                                            {fmt(m.net_profit)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {renderSalesMarginDetail(summary.sales_margin_detail)}
            </div>
        );
    };

    const renderCategoriesTab = () => {
        if (categoriesError) return (
            <div className="network-error-state" role="alert">
                <p className="font-semibold">{t('AccountingCategoriesUnavailable')}</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void refetchCategories()}>{t('Retry')}</button>
            </div>
        );
        return (
        <div className="space-y-4">
            <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">{t('NewCategory')}</h2>
                <form
                    className="flex gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        addCategory.mutate(newCatName.trim());
                        setNewCatName('');
                    }}
                >
                    <input
                        aria-label={t('CategoryName')}
                        type="text" placeholder={t('CategoryName')}
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="btn-primary flex items-center gap-2"
                        disabled={!newCatName.trim() || addCategory.isPending}
                    >
                        <Plus size={18} /> {t('Add')}
                    </button>
                </form>
            </div>
            <div className="card">
                <div className="card-header"><h2 className="font-semibold text-lg">{t('Categories')}</h2></div>
                <table>
                    <caption className="sr-only">{t('Categories')}</caption>
                    <thead><tr><th scope="col">{t('Name')}</th><th scope="col">{t('Type')}</th><th scope="col"><span className="sr-only">{t('Actions')}</span></th></tr></thead>
                    <tbody>
                        {categories.length === 0 ? (
                            <tr><td colSpan={3} className="text-center py-8 text-muted">{t('NoCategories')}</td></tr>
                        ) : categories.map(c => (
                            <tr key={c.id}>
                                <td className="font-medium">{c.name}</td>
                                <td>{c.is_default
                                    ? <span className="badge badge-accent">{t('Default')}</span>
                                    : <span className="badge">{t('Custom')}</span>}
                                </td>
                                <td className="text-right">
                                    {!c.is_default && (
                                        <button
                                            className="btn-ghost btn-icon text-red-500"
                                            onClick={() => setDeletionTarget({ type: 'category', id: c.id, name: c.name })}
                                            aria-label={t('DeleteCategory', { name: c.name })}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
        );
    };

    if (currentUserLoading) {
        return <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>;
    }

    if (currentUserError) {
        return (
            <div className="network-error-state" role="alert">
                <p className="font-semibold">{t('RoleVerificationUnavailable')}</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void refetchCurrentUser()}>{t('Retry')}</button>
            </div>
        );
    }

    if (!isAdmin && categoriesError) {
        return (
            <div className="network-error-state" role="alert">
                <p className="font-semibold">{t('AccountingExpenseFormUnavailable')}</p>
                <button type="button" className="btn-secondary mt-4" onClick={() => void refetchCategories()}>{t('Retry')}</button>
            </div>
        );
    }

    if (!isAdmin) {
        return renderCashierExpenseEntry();
    }

    return (
        <div className="accounting-page space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Calculator size={26} /> {t('Accounting')}
                </h1>
            </div>

            {/* Period selector */}
            <div className="card p-4 flex flex-wrap items-center gap-4">
                <div className="flex bg-tertiary rounded-lg p-1 max-w-full overflow-x-auto" role="tablist" aria-label={t('AccountingPeriod')}>
                    <button id="accounting-tab-day" aria-controls="accounting-panel-day" tabIndex={tab === 'day' ? 0 : -1} type="button" role="tab" aria-selected={tab === 'day'} onKeyDown={(event) => handleTabKeyDown(event, 'day')} onClick={() => setTab('day')} className={`px-4 py-2 rounded-md transition flex items-center gap-2 whitespace-nowrap ${tab === 'day' ? 'bg-accent text-white' : 'hover:bg-hover'}`}><CalendarDays size={16} /> {t('Daily')}</button>
                    <button id="accounting-tab-week" aria-controls="accounting-panel-week" tabIndex={tab === 'week' ? 0 : -1} type="button" role="tab" aria-selected={tab === 'week'} onKeyDown={(event) => handleTabKeyDown(event, 'week')} onClick={() => setTab('week')} className={`px-4 py-2 rounded-md transition flex items-center gap-2 whitespace-nowrap ${tab === 'week' ? 'bg-accent text-white' : 'hover:bg-hover'}`}><CalendarRange size={16} /> {t('Weekly')}</button>
                    <button id="accounting-tab-month" aria-controls="accounting-panel-month" tabIndex={tab === 'month' ? 0 : -1} type="button" role="tab" aria-selected={tab === 'month'} onKeyDown={(event) => handleTabKeyDown(event, 'month')} onClick={() => setTab('month')} className={`px-4 py-2 rounded-md transition whitespace-nowrap ${tab === 'month' ? 'bg-accent text-white' : 'hover:bg-hover'}`}>{t('Monthly')}</button>
                    <button id="accounting-tab-year" aria-controls="accounting-panel-year" tabIndex={tab === 'year' ? 0 : -1} type="button" role="tab" aria-selected={tab === 'year'} onKeyDown={(event) => handleTabKeyDown(event, 'year')} onClick={() => setTab('year')} className={`px-4 py-2 rounded-md transition whitespace-nowrap ${tab === 'year' ? 'bg-accent text-white' : 'hover:bg-hover'}`}>{t('Yearly')}</button>
                    <button id="accounting-tab-categories" aria-controls="accounting-panel-categories" tabIndex={tab === 'categories' ? 0 : -1} type="button" role="tab" aria-selected={tab === 'categories'} onKeyDown={(event) => handleTabKeyDown(event, 'categories')} onClick={() => setTab('categories')} className={`px-4 py-2 rounded-md transition whitespace-nowrap ${tab === 'categories' ? 'bg-accent text-white' : 'hover:bg-hover'}`}>{t('Categories')}</button>
                </div>

                {tab !== 'categories' && (
                    <div className="flex items-center gap-2 ml-auto">
                        {(tab === 'day' || tab === 'week') && (
                            <input
                                aria-label={t('AccountingPeriodDate')}
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-auto"
                            />
                        )}
                        {tab === 'month' && (
                            <>
                                <button type="button" className="btn-secondary btn-icon" aria-label={t('PreviousMonth')} onClick={() => {
                                    if (month === 1) { setMonth(12); setYear(y => y - 1); } else { setMonth(m => m - 1); }
                                }}><ChevronLeft size={20} /></button>
                                <select aria-label={t('AccountingMonth')} value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="w-auto">
                                    {monthNames.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                                </select>
                                <button type="button" className="btn-secondary btn-icon" aria-label={t('NextMonth')} onClick={() => {
                                    if (month === 12) { setMonth(1); setYear(y => y + 1); } else { setMonth(m => m + 1); }
                                }}><ChevronRight size={20} /></button>
                            </>
                        )}
                        {(tab === 'month' || tab === 'year') && (
                            <select aria-label={t('AccountingYear')} value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="w-auto">
                                {Array.from({ length: 6 }, (_, i) => now.getFullYear() - i).map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        )}
                    </div>
                )}
            </div>

            <div
                id={`accounting-panel-${tab}`}
                role="tabpanel"
                aria-labelledby={`accounting-tab-${tab}`}
                tabIndex={0}
            >
                {tab === 'day' && renderPeriodTab()}
                {tab === 'week' && renderPeriodTab()}
                {tab === 'month' && renderMonthTab()}
                {tab === 'year' && renderYearTab()}
                {tab === 'categories' && renderCategoriesTab()}
            </div>

            <ConfirmDialog
                open={Boolean(deletionTarget)}
                title={deletionTarget?.type === 'category' ? t('DeleteCategoryTitle') : t('DeleteExpenseTitle')}
                description={deletionTarget?.type === 'category'
                    ? t('DeleteCategoryDescription', { name: deletionTarget.name })
                    : t('DeleteExpenseDescription')}
                confirmLabel={t('Delete')}
                busy={deleteExpense.isPending || deleteCategory.isPending}
                onCancel={() => setDeletionTarget(null)}
                onConfirm={() => {
                    if (deletionTarget?.type === 'expense') deleteExpense.mutate(deletionTarget.id);
                    if (deletionTarget?.type === 'category') deleteCategory.mutate(deletionTarget.id);
                }}
            />
        </div>
    );
}
