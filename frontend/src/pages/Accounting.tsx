import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';

const MONTHS_FR = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const PIE_COLORS = ['#0f766e', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#64748b', '#2563eb'];
const axisTick = { fontSize: 11, fill: 'var(--color-text-muted)' };
const gridStroke = 'var(--color-border-light)';

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
    cash_after_withdrawal?: number;
    sales_margin_detail?: SalesMarginDetail;
}
interface YearSummary {
    year: number;
    months: Array<{
        month: number; label: string;
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
    }>;
    quarters: Array<{
        quarter: number; label: string;
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
    }>;
    category_breakdown: Array<{ category: string; total: number }>;
    sales_margin_detail?: SalesMarginDetail;
    totals: {
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
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
    net_profit: number;
    expenses_detail: Expense[];
    category_breakdown: Array<{ category: string; total: number }>;
    daily: Array<{
        date: string;
        label: string;
        revenue: number;
        gross_margin: number;
        expenses: number;
        net_profit: number;
    }>;
    sales_margin_detail?: SalesMarginDetail;
}

export default function Accounting() {
    const toast = useToast();
    const qc = useQueryClient();
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [selectedDate, setSelectedDate] = useState(toLocalDateInputValue(now));
    const [tab, setTab] = useState<'day' | 'week' | 'month' | 'year' | 'categories'>('day');
    const { data: currentUser, isLoading: currentUserLoading } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(r => r.data),
        retry: false,
        staleTime: 60_000,
    });
    const isAdmin = currentUser?.role === 'ADMIN';

    // ---------- Queries ----------
    const { data: categories = [] } = useQuery<Category[]>({
        queryKey: ['acc-categories'],
        queryFn: async () => {
            const r = await client.get('/accounting/categories/');
            return r.data.results ?? r.data;
        },
        enabled: Boolean(currentUser),
    });

    const { data: monthData, isLoading: monthLoading } = useQuery<MonthData>({
        queryKey: ['acc-month', year, month],
        queryFn: () => client.get(`/accounting/monthly/by-period/${year}/${month}/`).then(r => r.data),
        enabled: isAdmin,
        staleTime: 0,
    });

    const { data: summary } = useQuery<YearSummary>({
        queryKey: ['acc-summary', year],
        queryFn: () => client.get(`/accounting/summary/?year=${year}`).then(r => r.data),
        enabled: isAdmin,
        staleTime: 0,
    });

    const { data: periodSummary, isLoading: periodLoading, isError: periodIsError, error: periodError } = useQuery<PeriodSummary>({
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
            toast.success('Mois mis à jour');
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Erreur sauvegarde')),
    });

    const addWithdrawal = useMutation({
        mutationFn: async (payload: { amount: number; note: string; incurred_on: string }) => {
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
                });
            }
        },
        onSuccess: () => {
            toast.success('Retrait enregistré en dépense caisse');
            setWithdrawalDraft({ amount: '', note: '' });
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Erreur retrait')),
    });

    const addExpense = useMutation({
        mutationFn: (payload: { category: number; amount: number; description: string; paid_from_cash: boolean; incurred_on?: string; year?: number; month?: number }) =>
            client.post('/accounting/expenses/', { ...payload, year: payload.year ?? year, month: payload.month ?? month }),
        onSuccess: () => {
            toast.success('Dépense ajoutée');
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Erreur ajout depense')),
    });

    const deleteExpense = useMutation({
        mutationFn: (id: number) => client.delete(`/accounting/expenses/${id}/`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
            qc.invalidateQueries({ queryKey: ['cashRegister'] });
        },
    });

    const addCategory = useMutation({
        mutationFn: (name: string) => client.post('/accounting/categories/', { name }),
        onSuccess: () => {
            toast.success('Catégorie créée');
            qc.invalidateQueries({ queryKey: ['acc-categories'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Erreur creation categorie', 'name')),
    });

    const deleteCategory = useMutation({
        mutationFn: (id: number) => client.delete(`/accounting/categories/${id}/`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['acc-categories'] }),
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Suppression impossible')),
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

    const fmt = (n: number) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const submitCashierExpense = () => {
        if (!newExp.category || !newExp.amount) {
            toast.error('Choisissez une catégorie et un montant.');
            return;
        }
        const amount = parseDecimalInput(newExp.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error('Montant invalide.');
            return;
        }
        const dateParts = selectedDate.split('-').map(Number);
        addExpense.mutate({
            category: Number(newExp.category),
            amount,
            description: newExp.description,
            paid_from_cash: true,
            incurred_on: selectedDate,
            year: dateParts[0],
            month: dateParts[1],
        }, {
            onSuccess: () => setNewExp({ category: '', amount: '', description: '', paid_from_cash: true }),
        });
    };

    const renderCashierExpenseEntry = () => (
        <div className="accounting-page cashier-expense-page space-y-6 animate-fadeIn">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Calculator size={26} /> Dépenses
                </h1>
                <p className="text-muted mt-1">
                    Ajoutez uniquement les dépenses payées depuis la caisse. Les chiffres comptables restent réservés à l'admin.
                </p>
            </div>

            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold text-lg">Nouvelle dépense</h2>
                </div>
                <div className="card-body space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">Date</span>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(event) => setSelectedDate(event.target.value)}
                                className="mt-2"
                            />
                        </label>
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">Catégorie</span>
                            <select
                                value={newExp.category}
                                onChange={(event) => setNewExp({ ...newExp, category: event.target.value })}
                                className="mt-2"
                            >
                                <option value="">Choisir une catégorie</option>
                                {categories.map(category => (
                                    <option key={category.id} value={category.id}>{category.name}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <label className="block">
                        <span className="text-sm font-semibold text-muted">Montant payé</span>
                        <div className="flex rounded-xl border border-border bg-secondary focus-within:border-accent mt-2">
                            <input
                                type="text"
                                inputMode="decimal"
                                value={newExp.amount}
                                onChange={(event) => setNewExp({ ...newExp, amount: normalizeDecimalInput(event.target.value) })}
                                placeholder="0.00"
                                className="money-input text-2xl font-bold py-3 pl-4 pr-3"
                            />
                            <span className="px-4 flex items-center text-muted font-bold border-l border-border">DH</span>
                        </div>
                    </label>
                    <label className="block">
                        <span className="text-sm font-semibold text-muted">Description</span>
                        <textarea
                            value={newExp.description}
                            onChange={(event) => setNewExp({ ...newExp, description: event.target.value })}
                            placeholder="Ex: livraison, fournitures, retrait gérant..."
                            className="mt-2"
                            rows={3}
                        />
                    </label>
                    <div className="rounded-xl bg-warning-light text-warning p-4 text-sm font-medium">
                        Cette dépense sera automatiquement soustraite de la caisse.
                    </div>
                    <button
                        type="button"
                        onClick={submitCashierExpense}
                        disabled={addExpense.isPending || categories.length === 0}
                        className="btn-primary w-full py-3 font-bold"
                    >
                        <Plus size={18} />
                        Enregistrer la dépense
                    </button>
                </div>
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
                        <h2 className="font-semibold text-lg">Marge par vente</h2>
                    </div>
                    <div className="accounting-mobile-list">
                        {sales.length === 0 ? (
                            <div className="mobile-empty-card">Aucune vente sur cette période</div>
                        ) : sales.map(sale => (
                            <div key={`mobile-sale-${sale.id}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>Vente #{sale.id}</h3>
                                        <p>{new Date(sale.created_at).toLocaleString('fr-FR')}</p>
                                    </div>
                                    <span className="badge badge-accent">{sale.items_count} art.</span>
                                </div>
                                <div className="mobile-money-grid">
                                    <div>
                                        <span>CA</span>
                                        <strong>{fmt(sale.revenue)} DH</strong>
                                    </div>
                                    <div>
                                        <span>Achat</span>
                                        <strong>{fmt(sale.purchase_cost)} DH</strong>
                                    </div>
                                    <div>
                                        <span>Marge</span>
                                        <strong className={sale.margin >= 0 ? 'text-success' : 'text-red-500'}>{fmt(sale.margin)} DH</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <thead>
                                <tr>
                                    <th>Vente</th>
                                    <th>Articles</th>
                                    <th className="text-right">CA</th>
                                    <th className="text-right">Achat</th>
                                    <th className="text-right">Remise</th>
                                    <th className="text-right">Marge</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sales.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center py-8 text-muted">Aucune vente sur cette periode</td></tr>
                                ) : sales.map(sale => (
                                    <tr key={sale.id}>
                                        <td>
                                            <p className="font-medium">#{sale.id}</p>
                                            <p className="text-xs text-muted">
                                                {new Date(sale.created_at).toLocaleString('fr-FR')}
                                            </p>
                                        </td>
                                        <td>{sale.items_count}</td>
                                        <td className="text-right">{fmt(sale.revenue)} DH</td>
                                        <td className="text-right">{fmt(sale.purchase_cost)} DH</td>
                                        <td className="text-right">{fmt(sale.discount)} DH</td>
                                        <td className={`text-right font-semibold ${sale.margin >= 0 ? 'text-success' : 'text-red-500'}`}>
                                            {fmt(sale.margin)} DH
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
                        <h2 className="font-semibold text-lg">Articles vendus</h2>
                    </div>
                    <div className="accounting-mobile-list">
                        {products.length === 0 ? (
                            <div className="mobile-empty-card">Aucun article vendu sur cette période</div>
                        ) : products.map(product => (
                            <div key={`mobile-product-${product.product_id ?? product.product_name}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{product.product_name}</h3>
                                        <p>Quantité vendue: {product.quantity}</p>
                                    </div>
                                    <span className="badge badge-accent">x{product.quantity}</span>
                                </div>
                                <div className="mobile-money-grid">
                                    <div>
                                        <span>CA net</span>
                                        <strong>{fmt(product.revenue)} DH</strong>
                                    </div>
                                    <div>
                                        <span>Achat</span>
                                        <strong>{fmt(product.purchase_cost)} DH</strong>
                                    </div>
                                    <div>
                                        <span>Marge</span>
                                        <strong className={product.margin >= 0 ? 'text-success' : 'text-red-500'}>{fmt(product.margin)} DH</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <thead>
                                <tr>
                                    <th>Produit</th>
                                    <th className="text-right">Qte</th>
                                    <th className="text-right">CA net</th>
                                    <th className="text-right">Achat</th>
                                    <th className="text-right">Marge</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.length === 0 ? (
                                    <tr><td colSpan={5} className="text-center py-8 text-muted">Aucun article vendu sur cette periode</td></tr>
                                ) : products.map(product => (
                                    <tr key={`${product.product_id ?? product.product_name}`}>
                                        <td className="font-medium">{product.product_name}</td>
                                        <td className="text-right font-semibold">{product.quantity}</td>
                                        <td className="text-right">{fmt(product.revenue)} DH</td>
                                        <td className="text-right">{fmt(product.purchase_cost)} DH</td>
                                        <td className={`text-right font-semibold ${product.margin >= 0 ? 'text-success' : 'text-red-500'}`}>
                                            {fmt(product.margin)} DH
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
        if (periodLoading) return <div className="text-center py-12 text-muted">Chargement...</div>;
        if (periodIsError) {
            return (
                <div className="card p-6 text-center text-danger">
                    {getApiErrorMessage(periodError, 'Impossible de charger cette période')}
                </div>
            );
        }
        if (!periodSummary) return <div className="text-center py-12 text-muted">Aucune donnée</div>;

        const isWeek = tab === 'week';
        const periodLabel = isWeek
            ? `Du ${periodSummary.start_date} au ${periodSummary.end_date}`
            : periodSummary.date;

        return (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="stat-card">
                        <div className="stat-icon bg-success-light"><DollarSign size={24} className="text-success" /></div>
                        <div><p className="stat-label">CA</p><p className="stat-value">{fmt(periodSummary.revenue)} DH</p></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-blue-100"><TrendingUp size={24} className="text-blue-600" /></div>
                        <div><p className="stat-label">Marge brute</p><p className="stat-value">{fmt(periodSummary.gross_margin)} DH</p></div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-red-100"><TrendingDown size={24} className="text-red-500" /></div>
                        <div>
                            <p className="stat-label">Dépenses</p>
                            <p className="stat-value">{fmt(periodSummary.expenses)} DH</p>
                            {(periodSummary.expenses_undated_share ?? 0) > 0 && (
                                <p className="text-xs text-muted" title="Quote-part journalière des dépenses non-datées du mois">
                                    dont {fmt(periodSummary.expenses_undated_share || 0)} DH réparti
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-accent-light"><TrendingUp size={24} className="text-accent" /></div>
                        <div>
                            <p className="stat-label">Bénéfice net</p>
                            <p className={`stat-value ${periodSummary.net_profit >= 0 ? 'text-success' : 'text-red-500'}`}>
                                {fmt(periodSummary.net_profit)} DH
                            </p>
                        </div>
                    </div>
                </div>

                {isWeek && (
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><CalendarRange size={18} /></span>
                            Résultat par jour
                        </h2>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer>
                                <BarChart data={periodSummary.daily}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                                    <Tooltip content={<PremiumChartTooltip valueSuffix=" DH" />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                    <Legend />
                                    <Bar dataKey="revenue" name="CA" fill="#0f766e" radius={[8, 8, 3, 3]} maxBarSize={32} />
                                    <Bar dataKey="expenses" name="Dépenses" fill="#ef4444" radius={[8, 8, 3, 3]} maxBarSize={32} />
                                    <Bar dataKey="net_profit" name="Bénéfice net" fill="#0ea5e9" radius={[8, 8, 3, 3]} maxBarSize={32} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                <div className="card p-6">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                        <h2 className="text-lg font-semibold">Ajouter une dépense datée</h2>
                        <span className="text-sm text-muted">{periodLabel}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                        />
                        <select
                            value={newExp.category}
                            onChange={(e) => setNewExp({ ...newExp, category: e.target.value })}
                        >
                            <option value="">Catégorie...</option>
                            {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        <input
                            type="text" inputMode="decimal" placeholder="Montant"
                            value={newExp.amount}
                            onChange={(e) => setNewExp({ ...newExp, amount: normalizeDecimalInput(e.target.value) })}
                        />
                        <input
                            type="text" placeholder="Description"
                            value={newExp.description}
                            onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
                        />
                        <label className="flex items-center gap-2 px-3 py-2 bg-tertiary/40 rounded-lg text-sm font-medium">
                            <input
                                type="checkbox"
                                checked={newExp.paid_from_cash}
                                onChange={(e) => setNewExp({ ...newExp, paid_from_cash: e.target.checked })}
                                className="w-4 h-4"
                            />
                            Sortie caisse
                        </label>
                        <button
                            className="btn-primary flex items-center justify-center gap-2"
                            disabled={!newExp.category || !newExp.amount || addExpense.isPending}
                            onClick={() => {
                                const dateParts = selectedDate.split('-').map(Number);
                                addExpense.mutate({
                                    category: Number(newExp.category),
                                    amount: Number(newExp.amount),
                                    description: newExp.description,
                                    paid_from_cash: newExp.paid_from_cash,
                                    incurred_on: selectedDate,
                                    year: dateParts[0],
                                    month: dateParts[1],
                                });
                                if (dateParts.length === 3) {
                                    setYear(dateParts[0]);
                                    setMonth(dateParts[1]);
                                }
                                setNewExp({ category: '', amount: '', description: '', paid_from_cash: true });
                            }}
                        >
                            <Plus size={18} /> Ajouter
                        </button>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h2 className="font-semibold text-lg">Dépenses de la période</h2>
                    </div>
                    <div className="accounting-mobile-list">
                        {periodSummary.expenses_detail.length === 0 ? (
                            <div className="mobile-empty-card">Aucune dépense</div>
                        ) : periodSummary.expenses_detail.map(e => (
                            <div key={`mobile-period-expense-${e.id}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{e.description || e.category_name}</h3>
                                        <p>{e.incurred_on || 'Sans date'} · {e.category_name}</p>
                                    </div>
                                    <strong>{fmt(Number(e.amount))} DH</strong>
                                </div>
                                <div className="mobile-detail-actions">
                                    <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                        Caisse: {e.paid_from_cash ? 'Oui' : 'Non'}
                                    </span>
                                    <button
                                        onClick={() => deleteExpense.mutate(e.id)}
                                        className="btn-ghost btn-icon text-red-500"
                                        title="Supprimer"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Catégorie</th>
                                    <th>Description</th>
                                    <th>Caisse</th>
                                    <th className="text-right">Montant</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {periodSummary.expenses_detail.length === 0 ? (
                                    <tr><td colSpan={5} className="text-center py-8 text-muted">Aucune dépense</td></tr>
                                ) : periodSummary.expenses_detail.map(e => (
                                    <tr key={e.id}>
                                        <td>{e.incurred_on || '-'}</td>
                                        <td><span className="badge badge-accent">{e.category_name}</span></td>
                                        <td>{e.description || '-'}</td>
                                        <td>
                                            <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                                {e.paid_from_cash ? 'Oui' : 'Non'}
                                            </span>
                                        </td>
                                        <td className="text-right">{fmt(Number(e.amount))} DH</td>
                                        <td className="text-right">
                                            <button
                                                onClick={() => deleteExpense.mutate(e.id)}
                                                className="btn-ghost btn-icon text-red-500"
                                                title="Supprimer"
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
        if (monthLoading || !monthData) return <div className="text-center py-12 text-muted">Chargement...</div>;

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
            { name: 'CA', value: revenue, fill: '#10b981' },
            { name: 'Coût achat', value: cogs, fill: '#f59e0b' },
            { name: 'Marge brute', value: grossMargin, fill: '#3b82f6' },
            { name: 'Dépenses', value: totalExp, fill: '#ef4444' },
            { name: 'Bénéfice net', value: Math.max(0, net), fill: '#1e40af' },
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
                            <p className="stat-label">Chiffre d'affaires</p>
                            <p className="stat-value">{fmt(revenue)} DH</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-blue-100"><TrendingUp size={24} className="text-blue-600" /></div>
                        <div>
                            <p className="stat-label">Marge brute</p>
                            <p className="stat-value">{fmt(grossMargin)} DH</p>
                            <p className="text-xs text-muted">Vente − Achat</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-red-100"><TrendingDown size={24} className="text-red-500" /></div>
                        <div>
                            <p className="stat-label">Dépenses</p>
                            <p className="stat-value">{fmt(totalExp)} DH</p>
                        </div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-icon bg-accent-light"><TrendingUp size={24} className="text-accent" /></div>
                        <div>
                            <p className="stat-label">Bénéfice net</p>
                            <p className={`stat-value ${net >= 0 ? 'text-success' : 'text-red-500'}`}>{fmt(net)} DH</p>
                            <p className="text-xs text-muted">Marge − Dépenses</p>
                        </div>
                    </div>
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Décomposition CA -> Bénéfice */}
                    <div className="card chart-card p-6 lg:col-span-2">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingUp size={18} /></span>
                            Décomposition du résultat
                        </h2>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer>
                                <BarChart data={waterfall}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                                    <Tooltip content={<PremiumChartTooltip valueSuffix=" DH" />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                    <Bar dataKey="value" name="Montant" radius={[10, 10, 4, 4]} maxBarSize={48}>
                                        {waterfall.map((d, i) => (
                                            <Cell key={i} fill={d.fill} />
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
                            Dépenses par catégorie
                        </h2>
                        <div className="h-[280px] w-full">
                            {catData.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    Aucune dépense ce mois
                                </div>
                            ) : (
                                <ResponsiveContainer>
                                    <PieChart>
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
                                        <Tooltip content={<PremiumChartTooltip valueSuffix=" DH" />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Withdrawal + notes form */}
                <div className="card p-6">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                        <h2 className="text-lg font-semibold">Saisie du mois</h2>
                        <div className="text-sm text-muted">
                            Retrait gérant : <span className="font-semibold text-warning">{fmt(wd)} DH</span>
                            <span className="mx-2">•</span>
                            Reste après retrait : <span className={`font-semibold ${cashAfter >= 0 ? 'text-success' : 'text-red-500'}`}>{fmt(cashAfter)} DH</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl border border-border p-4 bg-tertiary/20">
                            <label className="block text-sm font-medium mb-1">Nouveau retrait (DH)</label>
                            <input
                                type="text" inputMode="decimal"
                                value={withdrawalDraft.amount}
                                onChange={(e) => setWithdrawalDraft({ ...withdrawalDraft, amount: normalizeDecimalInput(e.target.value) })}
                                placeholder="0.00"
                            />
                            <label className="block text-sm font-medium mt-3 mb-1">Note du retrait</label>
                            <input
                                type="text"
                                value={withdrawalDraft.note}
                                onChange={(e) => setWithdrawalDraft({ ...withdrawalDraft, note: e.target.value })}
                                placeholder="Retrait especes"
                            />
                            <button
                                className="btn-primary mt-4 w-full"
                                disabled={!canAddWithdrawal || addWithdrawal.isPending}
                                onClick={() => addWithdrawal.mutate({
                                    amount: withdrawalAmount,
                                    note: withdrawalDraft.note.trim() || 'Retrait gerant',
                                    incurred_on: monthExpenseDate,
                                })}
                            >
                                Ajouter le retrait
                            </button>
                        </div>
                        <div className="rounded-xl border border-border p-4 bg-tertiary/20">
                            <label className="block text-sm font-medium mb-1">Notes</label>
                            <input
                                type="text" value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Optionnel"
                            />
                            <button
                                className="btn-secondary mt-4 w-full"
                                disabled={saveMonthly.isPending}
                                onClick={() => saveMonthly.mutate({ notes })}
                            >
                                Sauvegarder la note
                            </button>
                        </div>
                    </div>
                </div>

                {/* Add expense */}
                <div className="card p-6">
                    <h2 className="text-lg font-semibold mb-4">Ajouter une dépense</h2>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <select
                            value={newExp.category}
                            onChange={(e) => setNewExp({ ...newExp, category: e.target.value })}
                        >
                            <option value="">Catégorie...</option>
                            {categories.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        <input
                            type="text" inputMode="decimal" placeholder="Montant"
                            value={newExp.amount}
                            onChange={(e) => setNewExp({ ...newExp, amount: normalizeDecimalInput(e.target.value) })}
                        />
                        <input
                            type="text" placeholder="Description (optionnel)"
                            value={newExp.description}
                            onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
                        />
                        <label className="flex items-center gap-2 px-3 py-2 bg-tertiary/40 rounded-lg text-sm font-medium">
                            <input
                                type="checkbox"
                                checked={newExp.paid_from_cash}
                                onChange={(e) => setNewExp({ ...newExp, paid_from_cash: e.target.checked })}
                                className="w-4 h-4"
                            />
                            Sortie caisse
                        </label>
                        <button
                            className="btn-primary flex items-center justify-center gap-2"
                            disabled={!newExp.category || !newExp.amount || addExpense.isPending}
                            onClick={() => {
                                addExpense.mutate({
                                    category: Number(newExp.category),
                                    amount: Number(newExp.amount),
                                    description: newExp.description,
                                    paid_from_cash: newExp.paid_from_cash,
                                });
                                setNewExp({ category: '', amount: '', description: '', paid_from_cash: true });
                            }}
                        >
                            <Plus size={18} /> Ajouter
                        </button>
                    </div>
                </div>

                {/* Expense list */}
                <div className="card">
                    <div className="card-header">
                        <h2 className="font-semibold text-lg">Dépenses du mois</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <thead>
                                <tr>
                                    <th>Catégorie</th>
                                    <th>Description</th>
                                    <th>Caisse</th>
                                    <th className="text-right">Montant</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {monthData.expenses.length === 0 ? (
                                    <tr><td colSpan={4} className="text-center py-8 text-muted">Aucune dépense</td></tr>
                                ) : monthData.expenses.map(e => (
                                    <tr key={e.id}>
                                        <td><span className="badge badge-accent">{e.category_name}</span></td>
                                        <td>{e.description || '—'}</td>
                                        <td>
                                            <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                                {e.paid_from_cash ? 'Oui' : 'Non'}
                                            </span>
                                        </td>
                                        <td className="text-right">{fmt(Number(e.amount))} DH</td>
                                        <td className="text-right">
                                            <button
                                                onClick={() => deleteExpense.mutate(e.id)}
                                                className="btn-ghost btn-icon text-red-500"
                                                title="Supprimer"
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
                        <div className="mobile-empty-card">Aucune dépense</div>
                    ) : monthData.expenses.map(e => (
                        <div key={`mobile-month-expense-${e.id}`} className="mobile-detail-card">
                            <div className="mobile-detail-card-header">
                                <div>
                                    <h3>{e.description || e.category_name}</h3>
                                    <p>{e.category_name}</p>
                                </div>
                                <strong>{fmt(Number(e.amount))} DH</strong>
                            </div>
                            <div className="mobile-detail-actions">
                                <span className={`badge ${e.paid_from_cash ? 'badge-warning' : 'badge-accent'}`}>
                                    Caisse: {e.paid_from_cash ? 'Oui' : 'Non'}
                                </span>
                                <button
                                    onClick={() => deleteExpense.mutate(e.id)}
                                    className="btn-ghost btn-icon text-red-500"
                                    title="Supprimer"
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
        if (!summary) return <div className="text-center py-12 text-muted">Chargement...</div>;
        return (
            <div className="space-y-6">
                {/* Year totals */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="stat-card"><div className="stat-icon bg-success-light"><DollarSign size={24} className="text-success" /></div>
                        <div><p className="stat-label">CA annuel</p><p className="stat-value">{fmt(summary.totals.revenue)} DH</p></div></div>
                    <div className="stat-card"><div className="stat-icon bg-warning-light"><TrendingDown size={24} className="text-warning" /></div>
                        <div><p className="stat-label">Retraits gérant</p><p className="stat-value">{fmt(summary.totals.manager_withdrawal)} DH</p></div></div>
                    <div className="stat-card"><div className="stat-icon bg-red-100"><TrendingDown size={24} className="text-red-500" /></div>
                        <div><p className="stat-label">Dépenses</p><p className="stat-value">{fmt(summary.totals.expenses)} DH</p></div></div>
                    <div className="stat-card"><div className="stat-icon bg-accent-light"><TrendingUp size={24} className="text-accent" /></div>
                        <div><p className="stat-label">Bénéfice net annuel</p>
                            <p className={`stat-value ${summary.totals.net_profit >= 0 ? 'text-success' : 'text-red-500'}`}>{fmt(summary.totals.net_profit)} DH</p></div></div>
                </div>

                {/* Quarter cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {summary.quarters.map(q => (
                        <div key={q.quarter} className="card p-4">
                            <p className="text-sm text-muted">{q.label}</p>
                            <p className="text-xl font-bold">{fmt(q.net_profit)} DH</p>
                            <p className="text-xs text-muted mt-1">CA: {fmt(q.revenue)} • Dép: {fmt(q.expenses)}</p>
                        </div>
                    ))}
                </div>

                {/* Chart 1: Revenue vs Expenses (bar) */}
                <div className="card chart-card p-6">
                    <h2 className="chart-title mb-4">
                        <span className="chart-title-icon"><DollarSign size={18} /></span>
                        CA vs Dépenses
                    </h2>
                    <div className="h-[320px] w-full">
                        <ResponsiveContainer>
                            <BarChart data={summary.months}>
                                <CartesianGrid stroke={gridStroke} vertical={false} />
                                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${v}`} />
                                <Tooltip content={<PremiumChartTooltip valueSuffix=" DH" />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                <Legend />
                                <Bar dataKey="revenue" name="CA" fill="#10b981" radius={[8, 8, 3, 3]} maxBarSize={34} />
                                <Bar dataKey="expenses" name="Dépenses" fill="#ef4444" radius={[8, 8, 3, 3]} maxBarSize={34} />
                                <Bar dataKey="manager_withdrawal" name="Retrait gérant" fill="#f59e0b" radius={[8, 8, 3, 3]} maxBarSize={34} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Chart 2: Expense breakdown (pie) */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingDown size={18} /></span>
                            Dépenses par catégorie
                        </h2>
                        <div className="h-[320px] w-full">
                            {summary.category_breakdown.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted">Aucune dépense enregistrée</div>
                            ) : (
                                <ResponsiveContainer>
                                    <PieChart>
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
                                        <Tooltip content={<PremiumChartTooltip valueSuffix=" DH" />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Chart 3: Net profit trend (line) */}
                    <div className="card chart-card p-6">
                        <h2 className="chart-title mb-4">
                            <span className="chart-title-icon"><TrendingUp size={18} /></span>
                            Bénéfice net mensuel
                        </h2>
                        <div className="h-[320px] w-full">
                            <ResponsiveContainer>
                                <LineChart data={summary.months}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} />
                                    <Tooltip content={<PremiumChartTooltip valueSuffix=" DH" />} cursor={{ stroke: 'var(--color-accent)', strokeOpacity: 0.18 }} />
                                    <Line
                                        type="monotone"
                                        dataKey="net_profit"
                                        name="Bénéfice net"
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
                    <div className="card-header"><h2 className="font-semibold text-lg">Détail mensuel {year}</h2></div>
                    <div className="accounting-mobile-list">
                        {summary.months.map(m => (
                            <div key={`mobile-year-${m.month}`} className="mobile-detail-card">
                                <div className="mobile-detail-card-header">
                                    <div>
                                        <h3>{m.label}</h3>
                                        <p>Retrait: {fmt(m.manager_withdrawal)} DH</p>
                                    </div>
                                    <strong className={m.net_profit >= 0 ? 'text-success' : 'text-red-500'}>
                                        {fmt(m.net_profit)} DH
                                    </strong>
                                </div>
                                <div className="mobile-money-grid">
                                    <div>
                                        <span>CA</span>
                                        <strong>{fmt(m.revenue)} DH</strong>
                                    </div>
                                    <div>
                                        <span>Dépenses</span>
                                        <strong>{fmt(m.expenses)} DH</strong>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="overflow-x-auto">
                        <table>
                            <thead>
                                <tr>
                                    <th>Mois</th>
                                    <th className="text-right">CA</th>
                                    <th className="text-right">Retrait</th>
                                    <th className="text-right">Dépenses</th>
                                    <th className="text-right">Bénéfice net</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summary.months.map(m => (
                                    <tr key={m.month}>
                                        <td className="font-medium">
                                            <button className="text-accent hover:underline" onClick={() => { setMonth(m.month); setTab('month'); }}>
                                                {MONTHS_FR[m.month - 1]}
                                            </button>
                                        </td>
                                        <td className="text-right">{fmt(m.revenue)} DH</td>
                                        <td className="text-right">{fmt(m.manager_withdrawal)} DH</td>
                                        <td className="text-right">{fmt(m.expenses)} DH</td>
                                        <td className={`text-right font-medium ${m.net_profit >= 0 ? 'text-success' : 'text-red-500'}`}>
                                            {fmt(m.net_profit)} DH
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

    const renderCategoriesTab = () => (
        <div className="space-y-4">
            <div className="card p-6">
                <h2 className="text-lg font-semibold mb-4">Nouvelle catégorie</h2>
                <div className="flex gap-3">
                    <input
                        type="text" placeholder="Nom de la catégorie"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                    />
                    <button
                        className="btn-primary flex items-center gap-2"
                        disabled={!newCatName.trim() || addCategory.isPending}
                        onClick={() => { addCategory.mutate(newCatName.trim()); setNewCatName(''); }}
                    >
                        <Plus size={18} /> Ajouter
                    </button>
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h2 className="font-semibold text-lg">Catégories</h2></div>
                <table>
                    <thead><tr><th>Nom</th><th>Type</th><th></th></tr></thead>
                    <tbody>
                        {categories.map(c => (
                            <tr key={c.id}>
                                <td className="font-medium">{c.name}</td>
                                <td>{c.is_default
                                    ? <span className="badge badge-accent">Par défaut</span>
                                    : <span className="badge">Personnalisée</span>}
                                </td>
                                <td className="text-right">
                                    {!c.is_default && (
                                        <button
                                            className="btn-ghost btn-icon text-red-500"
                                            onClick={() => deleteCategory.mutate(c.id)}
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

    if (currentUserLoading) {
        return <div className="text-center py-12 text-muted">Chargement...</div>;
    }

    if (!isAdmin) {
        return renderCashierExpenseEntry();
    }

    return (
        <div className="accounting-page space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Calculator size={26} /> Comptabilité
                </h1>
            </div>

            {/* Period selector */}
            <div className="card p-4 flex flex-wrap items-center gap-4">
                <div className="flex bg-tertiary rounded-lg p-1">
                    <button onClick={() => setTab('day')} className={`px-4 py-2 rounded-md transition flex items-center gap-2 ${tab === 'day' ? 'bg-accent text-white' : 'hover:bg-hover'}`}><CalendarDays size={16} /> Quotidien</button>
                    <button onClick={() => setTab('week')} className={`px-4 py-2 rounded-md transition flex items-center gap-2 ${tab === 'week' ? 'bg-accent text-white' : 'hover:bg-hover'}`}><CalendarRange size={16} /> Hebdomadaire</button>
                    <button onClick={() => setTab('month')} className={`px-4 py-2 rounded-md transition ${tab === 'month' ? 'bg-accent text-white' : 'hover:bg-hover'}`}>Mensuel</button>
                    <button onClick={() => setTab('year')} className={`px-4 py-2 rounded-md transition ${tab === 'year' ? 'bg-accent text-white' : 'hover:bg-hover'}`}>Annuel</button>
                    <button onClick={() => setTab('categories')} className={`px-4 py-2 rounded-md transition ${tab === 'categories' ? 'bg-accent text-white' : 'hover:bg-hover'}`}>Catégories</button>
                </div>

                {tab !== 'categories' && (
                    <div className="flex items-center gap-2 ml-auto">
                        {(tab === 'day' || tab === 'week') && (
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-auto"
                            />
                        )}
                        {tab === 'month' && (
                            <>
                                <button className="btn-secondary btn-icon" onClick={() => {
                                    if (month === 1) { setMonth(12); setYear(y => y - 1); } else { setMonth(m => m - 1); }
                                }}><ChevronLeft size={20} /></button>
                                <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className="w-auto">
                                    {MONTHS_FR.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
                                </select>
                                <button className="btn-secondary btn-icon" onClick={() => {
                                    if (month === 12) { setMonth(1); setYear(y => y + 1); } else { setMonth(m => m + 1); }
                                }}><ChevronRight size={20} /></button>
                            </>
                        )}
                        {(tab === 'month' || tab === 'year') && (
                            <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="w-auto">
                                {Array.from({ length: 6 }, (_, i) => now.getFullYear() - i).map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        )}
                    </div>
                )}
            </div>

            {tab === 'day' && renderPeriodTab()}
            {tab === 'week' && renderPeriodTab()}
            {tab === 'month' && renderMonthTab()}
            {tab === 'year' && renderYearTab()}
            {tab === 'categories' && renderCategoriesTab()}
        </div>
    );
}
