import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
    Calculator, DollarSign, TrendingUp, TrendingDown,
    Plus, Trash2, ChevronLeft, ChevronRight, CalendarDays, CalendarRange,
} from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import PremiumChartTooltip from '../components/PremiumChartTooltip';

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

interface Category { id: number; name: string; is_default: boolean; }
interface Expense {
    id: number; category: number; category_name: string;
    amount: string | number; description: string; incurred_on: string | null;
}
interface MonthData {
    id: number; year: number; month: number;
    manager_withdrawal: string | number; notes: string;
    expenses: Expense[]; total_expenses: number;
    revenue: number;
    gross_margin?: number;
    net_profit: number;
    cash_after_withdrawal?: number;
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
    totals: {
        revenue: number; manager_withdrawal: number;
        expenses: number; net_profit: number;
    };
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
}

export default function Accounting() {
    const toast = useToast();
    const qc = useQueryClient();
    const now = new Date();
    const [year, setYear] = useState(now.getFullYear());
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [selectedDate, setSelectedDate] = useState(now.toISOString().slice(0, 10));
    const [tab, setTab] = useState<'day' | 'week' | 'month' | 'year' | 'categories'>('day');

    // ---------- Queries ----------
    const { data: categories = [] } = useQuery<Category[]>({
        queryKey: ['acc-categories'],
        queryFn: async () => {
            const r = await client.get('/accounting/categories/');
            return r.data.results ?? r.data;
        },
    });

    const { data: monthData, isLoading: monthLoading } = useQuery<MonthData>({
        queryKey: ['acc-month', year, month],
        queryFn: () => client.get(`/accounting/monthly/by-period/${year}/${month}/`).then(r => r.data),
    });

    const { data: summary } = useQuery<YearSummary>({
        queryKey: ['acc-summary', year],
        queryFn: () => client.get(`/accounting/summary/?year=${year}`).then(r => r.data),
    });

    const { data: periodSummary, isLoading: periodLoading, isError: periodIsError, error: periodError } = useQuery<PeriodSummary>({
        queryKey: ['acc-period', tab, selectedDate],
        queryFn: () => client
            .get(`/accounting/period-summary/?type=${tab === 'week' ? 'week' : 'day'}&date=${selectedDate}`)
            .then(r => r.data),
        enabled: tab === 'day' || tab === 'week',
        retry: 1,
    });

    // ---------- Mutations ----------
    const saveMonthly = useMutation({
        mutationFn: (payload: { manager_withdrawal: number; notes: string }) =>
            client.patch(`/accounting/monthly/${monthData!.id}/`, payload),
        onSuccess: () => {
            toast.success('Mois mis à jour');
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Erreur sauvegarde')),
    });

    const addExpense = useMutation({
        mutationFn: (payload: { category: number; amount: number; description: string; incurred_on?: string; year?: number; month?: number }) =>
            client.post('/accounting/expenses/', { ...payload, year: payload.year ?? year, month: payload.month ?? month }),
        onSuccess: () => {
            toast.success('Dépense ajoutée');
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
        },
        onError: (e: unknown) => toast.error(getApiErrorMessage(e, 'Erreur ajout depense')),
    });

    const deleteExpense = useMutation({
        mutationFn: (id: number) => client.delete(`/accounting/expenses/${id}/`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['acc-month', year, month] });
            qc.invalidateQueries({ queryKey: ['acc-summary', year] });
            qc.invalidateQueries({ queryKey: ['acc-period'] });
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
        withdrawal: '',
        notes: '',
    });
    const [newExp, setNewExp] = useState({ category: '', amount: '', description: '' });
    const [newCatName, setNewCatName] = useState('');

    const currentMonthId = monthData?.id ?? null;
    const withdrawal = monthData && monthDraft.id === monthData.id
        ? monthDraft.withdrawal
        : String(monthData?.manager_withdrawal ?? '');
    const notes = monthData && monthDraft.id === monthData.id
        ? monthDraft.notes
        : (monthData?.notes ?? '');
    const setWithdrawal = (value: string) => {
        setMonthDraft({ id: currentMonthId, withdrawal: value, notes });
    };
    const setNotes = (value: string) => {
        setMonthDraft({ id: currentMonthId, withdrawal, notes: value });
    };

    const fmt = (n: number) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ---------- Render helpers ----------
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
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
                            type="number" step="0.01" min="0" placeholder="Montant"
                            value={newExp.amount}
                            onChange={(e) => setNewExp({ ...newExp, amount: e.target.value })}
                        />
                        <input
                            type="text" placeholder="Description"
                            value={newExp.description}
                            onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
                        />
                        <button
                            className="btn-primary flex items-center justify-center gap-2"
                            disabled={!newExp.category || !newExp.amount || addExpense.isPending}
                            onClick={() => {
                                const dateParts = selectedDate.split('-').map(Number);
                                addExpense.mutate({
                                    category: Number(newExp.category),
                                    amount: Number(newExp.amount),
                                    description: newExp.description,
                                    incurred_on: selectedDate,
                                    year: dateParts[0],
                                    month: dateParts[1],
                                });
                                if (dateParts.length === 3) {
                                    setYear(dateParts[0]);
                                    setMonth(dateParts[1]);
                                }
                                setNewExp({ category: '', amount: '', description: '' });
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
                    <div className="overflow-x-auto">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Catégorie</th>
                                    <th>Description</th>
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
        const cashAfter = monthData.cash_after_withdrawal ?? (net - wd);

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
                        <div>
                            <label className="block text-sm font-medium mb-1">Retrait du gérant (DH)</label>
                            <input
                                type="number" step="0.01" min="0"
                                value={withdrawal}
                                onChange={(e) => setWithdrawal(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Notes</label>
                            <input
                                type="text" value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Optionnel"
                            />
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <button
                            className="btn-primary"
                            disabled={saveMonthly.isPending}
                            onClick={() => saveMonthly.mutate({
                                manager_withdrawal: Number(withdrawal) || 0,
                                notes,
                            })}
                        >
                            Enregistrer
                        </button>
                    </div>
                </div>

                {/* Add expense */}
                <div className="card p-6">
                    <h2 className="text-lg font-semibold mb-4">Ajouter une dépense</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
                            type="number" step="0.01" min="0" placeholder="Montant"
                            value={newExp.amount}
                            onChange={(e) => setNewExp({ ...newExp, amount: e.target.value })}
                        />
                        <input
                            type="text" placeholder="Description (optionnel)"
                            value={newExp.description}
                            onChange={(e) => setNewExp({ ...newExp, description: e.target.value })}
                        />
                        <button
                            className="btn-primary flex items-center justify-center gap-2"
                            disabled={!newExp.category || !newExp.amount || addExpense.isPending}
                            onClick={() => {
                                addExpense.mutate({
                                    category: Number(newExp.category),
                                    amount: Number(newExp.amount),
                                    description: newExp.description,
                                });
                                setNewExp({ category: '', amount: '', description: '' });
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

    return (
        <div className="space-y-6 animate-fadeIn">
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
