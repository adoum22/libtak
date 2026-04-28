import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import client from '../api/client';
import { useTranslation } from 'react-i18next';
import {
    TrendingUp,
    ShoppingBag,
    AlertTriangle,
    DollarSign,
    ArrowUpRight,
    ArrowDownRight,
    Package,
    Activity,
    Trophy,
} from 'lucide-react';
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import PremiumChartTooltip from '../components/PremiumChartTooltip';

interface DailyData {
    total_sales: number;
    total_revenue: number;
    revenue_change?: number;
    sales_count: number;
    revenue: number;
}

interface StatsData {
    today: DailyData;
    week: { sales_count: number; revenue: number };
    month: { sales_count: number; revenue: number };
    top_products: Array<{
        product__name: string;
        total_qty: number;
        total_revenue: number;
    }>;
    to_replenish_count?: number;
    low_stock_only_count?: number;
    out_of_stock_count?: number;
    low_stock: Array<{
        id: number;
        name: string;
        stock: number;
        min_stock: number;
    }>;
    low_stock_count?: number;
    revenue_7d?: Array<{
        label: string;
        date: string;
        revenue: number;
        count: number;
    }>;
    hourly_today?: Array<{
        label: string;
        revenue: number;
        count: number;
    }>;
}

type ChartRange = 7 | 30 | 90;

const axisTick = { fontSize: 11, fill: 'var(--color-text-muted)' };
const gridStroke = 'var(--color-border-light)';

export default function Dashboard() {
    const { t } = useTranslation();
    const [range, setRange] = useState<ChartRange>(7);

    const { data: stats, isLoading } = useQuery<StatsData>({
        queryKey: ['dashboardStats', range],
        queryFn: () => client.get(`/reporting/stats/?days=${range}`).then(res => res.data),
        refetchInterval: 30000, // Refresh every 30s
        refetchOnWindowFocus: true, // re-check quand on revient sur l'onglet
        staleTime: 0,
    });

    const rangeOptions: { value: ChartRange; label: string }[] = [
        { value: 7, label: '7 jours' },
        { value: 30, label: '30 jours' },
        { value: 90, label: '3 mois' },
    ];

    const scrollToLowStock = () => {
        document.getElementById('low-stock-section')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    };

    if (isLoading) {
        return (
            <div className="space-y-6">
                <h1 className="text-2xl font-bold">{t('Dashboard')}</h1>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="stat-card animate-pulse">
                            <div className="stat-icon bg-tertiary" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 bg-tertiary rounded w-20" />
                                <div className="h-8 bg-tertiary rounded w-24" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const revenueChange = stats?.today?.revenue_change || 0;

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t('Dashboard')}</h1>
                <span className="text-sm text-muted">
                    Dernière mise à jour: {new Date().toLocaleTimeString('fr-FR')}
                </span>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Today Sales */}
                <div className="stat-card">
                    <div className="stat-icon bg-accent-light">
                        <ShoppingBag size={24} className="text-accent" />
                    </div>
                    <div>
                        <p className="stat-label">Ventes aujourd'hui</p>
                        <p className="stat-value">{stats?.today?.sales_count || 0}</p>
                    </div>
                </div>

                {/* Today Revenue */}
                <div className="stat-card">
                    <div className="stat-icon bg-success-light">
                        <DollarSign size={24} className="text-success" />
                    </div>
                    <div>
                        <p className="stat-label">CA aujourd'hui</p>
                        <p className="stat-value">
                            {(stats?.today?.revenue || 0).toLocaleString('fr-FR')} DH
                        </p>
                        {revenueChange !== 0 && (
                            <div className={`flex items-center gap-1 text-sm ${revenueChange > 0 ? 'text-success' : 'text-danger'}`}>
                                {revenueChange > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                <span>{Math.abs(revenueChange).toFixed(1)}% vs hier</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Month Revenue */}
                <div className="stat-card">
                    <div className="stat-icon bg-warning-light">
                        <TrendingUp size={24} className="text-warning" />
                    </div>
                    <div>
                        <p className="stat-label">CA ce mois</p>
                        <p className="stat-value">
                            {(stats?.month?.revenue || 0).toLocaleString('fr-FR')} DH
                        </p>
                        <p className="text-sm text-muted">
                            {stats?.month?.sales_count || 0} ventes
                        </p>
                    </div>
                </div>

                {/* À réapprovisionner = stock <= seuil (inclut ruptures) */}
                <button
                    type="button"
                    onClick={scrollToLowStock}
                    className="stat-card cursor-pointer hover:scale-105 transition-transform text-left w-full"
                >
                    <div className="stat-icon bg-danger-light">
                        <AlertTriangle size={24} className="text-danger" />
                    </div>
                    <div>
                        <p className="stat-label">À réapprovisionner</p>
                        <p className="stat-value">
                            {stats?.to_replenish_count ?? stats?.low_stock_count ?? stats?.low_stock?.length ?? 0}
                        </p>
                        <p className="text-sm text-muted">
                            {(stats?.out_of_stock_count ?? 0) > 0 ? (
                                <>
                                    dont <span className="text-danger font-semibold">{stats?.out_of_stock_count} en rupture</span>
                                    {(stats?.low_stock_only_count ?? 0) > 0 && (
                                        <> + <span className="text-warning font-semibold">{stats?.low_stock_only_count} bas</span></>
                                    )}
                                </>
                            ) : (
                                'produits à réapprovisionner'
                            )}
                        </p>
                    </div>
                </button>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* CA — période sélectionnable */}
                <div className="card chart-card">
                    <div className="card-header flex items-center justify-between gap-3 flex-wrap">
                        <h2 className="chart-title">
                            <span className="chart-title-icon"><TrendingUp size={18} /></span>
                            CA — {rangeOptions.find(r => r.value === range)?.label}
                        </h2>
                        <div className="inline-flex bg-tertiary rounded-lg p-1 text-sm">
                            {rangeOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setRange(opt.value)}
                                    className={`px-3 py-1.5 rounded-md transition font-medium ${
                                        range === opt.value
                                            ? 'bg-accent text-white shadow-sm'
                                            : 'text-muted hover:text-primary'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="card-body">
                        {stats?.revenue_7d?.some(d => d.revenue > 0) ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <AreaChart data={stats.revenue_7d}>
                                    <defs>
                                        <linearGradient id="caGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#0f766e" stopOpacity={0.36} />
                                            <stop offset="80%" stopColor="#0f766e" stopOpacity={0.04} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} />
                                    <Tooltip
                                        content={<PremiumChartTooltip valueSuffix=" DH" />}
                                        cursor={{ stroke: 'var(--color-accent)', strokeOpacity: 0.18 }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="revenue"
                                        name="CA"
                                        stroke="#0f766e"
                                        strokeWidth={3}
                                        fill="url(#caGradient)"
                                        activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--color-bg-secondary)' }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="text-center py-12 text-muted">
                                Pas de ventes sur les 7 derniers jours.
                            </div>
                        )}
                    </div>
                </div>

                {/* Activité par heure aujourd'hui */}
                <div className="card chart-card">
                    <div className="card-header">
                        <h2 className="chart-title">
                            <span className="chart-title-icon"><Activity size={18} /></span>
                            Activité par heure
                        </h2>
                    </div>
                    <div className="card-body">
                        {stats?.hourly_today?.some(h => h.revenue > 0) ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={stats.hourly_today}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} />
                                    <Tooltip
                                        content={<PremiumChartTooltip valueSuffix=" DH" />}
                                        cursor={{ fill: 'var(--color-accent-light)' }}
                                    />
                                    <Bar dataKey="revenue" name="CA" fill="#10b981" radius={[10, 10, 4, 4]} maxBarSize={38} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="text-center py-12 text-muted">
                                Pas encore de ventes aujourd'hui.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Top produits BarChart horizontal */}
            {stats?.top_products && stats.top_products.length > 0 && (
                <div className="card chart-card">
                    <div className="card-header">
                        <h2 className="chart-title">
                            <span className="chart-title-icon"><Trophy size={18} /></span>
                            Top produits — quantité
                        </h2>
                    </div>
                    <div className="card-body">
                        <ResponsiveContainer width="100%" height={Math.max(180, stats.top_products.length * 42)}>
                            <BarChart
                                data={stats.top_products.map(p => ({
                                    name: (p.product__name || '').slice(0, 28),
                                    qty: Number(p.total_qty) || 0,
                                }))}
                                layout="vertical"
                                margin={{ left: 16, right: 16 }}
                            >
                                <CartesianGrid stroke={gridStroke} horizontal={false} />
                                <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                                <YAxis dataKey="name" type="category" tick={axisTick} tickLine={false} axisLine={false} width={150} />
                                <Tooltip content={<PremiumChartTooltip />} cursor={{ fill: 'var(--color-accent-light)' }} />
                                <Bar dataKey="qty" name="Quantité" fill="#0f766e" radius={[0, 10, 10, 0]} maxBarSize={28} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Products */}
                <div className="card">
                    <div className="card-header flex items-center justify-between">
                        <h2 className="chart-title">
                            <span className="chart-title-icon"><Trophy size={18} /></span>
                            Top produits du mois
                        </h2>
                    </div>
                    <div className="card-body p-0">
                        <table>
                            <thead>
                                <tr>
                                    <th>Produit</th>
                                    <th className="text-right">Qté</th>
                                    <th className="text-right">CA</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats?.top_products?.length ? (
                                    stats.top_products.map((p, i) => (
                                        <tr key={p.product__name ?? i}>
                                            <td className="flex items-center gap-3">
                                                <span className="w-6 h-6 rounded-full bg-accent-light text-accent text-xs flex items-center justify-center font-semibold">
                                                    {i + 1}
                                                </span>
                                                <span className="font-medium">{p.product__name}</span>
                                            </td>
                                            <td className="text-right">
                                                <span className="badge badge-accent">{p.total_qty}</span>
                                            </td>
                                            <td className="text-right font-medium">
                                                {p.total_revenue?.toLocaleString('fr-FR')} DH
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={3} className="text-center text-muted py-8">
                                            Aucune vente ce mois
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Low Stock Alert */}
                <div id="low-stock-section" className="card">
                    <div className="card-header flex items-center justify-between">
                        <h2 className="chart-title">
                            <span className="chart-title-icon"><AlertTriangle size={18} /></span>
                            Alertes stock bas
                        </h2>
                    </div>
                    <div className="card-body p-0">
                        {stats?.low_stock?.length ? (
                            <div className="divide-y">
                                {stats.low_stock.map((product) => (
                                    <div key={product.id} className="flex items-center justify-between p-4 hover:bg-hover transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-danger-light flex items-center justify-center">
                                                <Package size={20} className="text-danger" />
                                            </div>
                                            <div>
                                                <p className="font-medium">{product.name}</p>
                                                <p className="text-sm text-muted">
                                                    Min: {product.min_stock} unités
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className={`badge ${product.stock === 0 ? 'badge-danger' : 'badge-warning'}`}>
                                                {product.stock} en stock
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted">
                                <Package size={48} className="mx-auto mb-4 opacity-30" />
                                <p>Tous les stocks sont OK ✓</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
