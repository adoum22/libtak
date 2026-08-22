import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import client from '../api/client';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
    BellRing,
    CheckCircle2,
    ChevronRight,
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
import { getSuggestedRestock } from '../utils/inventoryRestock';
import useCurrency from '../hooks/useCurrency';

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
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
    const navigate = useNavigate();
    const [range, setRange] = useState<ChartRange>(7);

    const { data: stats, isLoading, isError, refetch, dataUpdatedAt } = useQuery<StatsData>({
        queryKey: ['dashboardStats', range],
        queryFn: () => client.get(`/reporting/stats/?days=${range}`).then(res => res.data),
        refetchInterval: 30000, // Refresh every 30s
        refetchOnWindowFocus: true, // re-check quand on revient sur l'onglet
        staleTime: 0,
    });

    const rangeOptions: { value: ChartRange; label: string }[] = [
        { value: 7, label: t('SevenDays') },
        { value: 30, label: t('ThirtyDays') },
        { value: 90, label: t('ThreeMonths') },
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
                    {['sales', 'daily-revenue', 'monthly-revenue', 'stock'].map(section => (
                        <div key={section} className="stat-card animate-pulse">
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

    if (isError) {
        return (
            <div className="space-y-6" role="status" aria-busy="true">
                <h1 className="text-2xl font-bold">{t('Dashboard')}</h1>
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">{t('DashboardUnavailable')}</p>
                    <p className="text-sm mt-2">{t('DashboardUnavailableHint')}</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button>
                </div>
            </div>
        );
    }

    const revenueChange = stats?.today?.revenue_change || 0;
    const outOfStockCount = stats?.out_of_stock_count ?? 0;
    const lowStockCount = stats?.low_stock_only_count ?? 0;
    const hasOperationalAlert = outOfStockCount > 0 || lowStockCount > 0 || (stats?.today?.sales_count ?? 0) === 0 || revenueChange < 0;

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t('Dashboard')}</h1>
                <span className="text-sm text-muted">
                    {t('LastUpdated', { time: new Date(dataUpdatedAt).toLocaleTimeString(i18n.language) })}
                </span>
            </div>

            <section className="card" aria-labelledby="operational-alerts-title">
                <div className="card-header flex items-center justify-between gap-3 flex-wrap">
                    <h2 id="operational-alerts-title" className="chart-title">
                        <span className="chart-title-icon"><BellRing size={18} /></span>
                        {t('OperationalAlerts')}
                    </h2>
                    {!hasOperationalAlert && (
                        <span className="badge badge-success flex items-center gap-1">
                            <CheckCircle2 size={14} /> {t('OperationsHealthy')}
                        </span>
                    )}
                </div>
                <div className="card-body grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {outOfStockCount > 0 && (
                        <button
                            type="button"
                            className="rounded-xl border border-danger/30 bg-danger-light p-4 text-left flex items-center justify-between gap-3 hover:brightness-95"
                            onClick={() => navigate('/inventory?stock=out')}
                        >
                            <span>
                                <strong className="block text-danger">{t('OutOfStockAlertTitle', { count: outOfStockCount })}</strong>
                                <span className="text-sm text-muted">{t('OutOfStockAlertHint')}</span>
                            </span>
                            <ChevronRight size={20} className="text-danger shrink-0" />
                        </button>
                    )}
                    {lowStockCount > 0 && (
                        <button
                            type="button"
                            className="rounded-xl border border-warning/30 bg-warning-light p-4 text-left flex items-center justify-between gap-3 hover:brightness-95"
                            onClick={() => navigate('/inventory?stock=low')}
                        >
                            <span>
                                <strong className="block text-warning">{t('LowStockAlertTitle', { count: lowStockCount })}</strong>
                                <span className="text-sm text-muted">{t('LowStockAlertHint')}</span>
                            </span>
                            <ChevronRight size={20} className="text-warning shrink-0" />
                        </button>
                    )}
                    {(stats?.today?.sales_count ?? 0) === 0 && (
                        <div className="rounded-xl border border-border bg-tertiary p-4">
                            <strong className="block">{t('NoSalesTodayAlert')}</strong>
                            <span className="text-sm text-muted">{t('NoSalesTodayHint')}</span>
                        </div>
                    )}
                    {revenueChange < 0 && (
                        <div className="rounded-xl border border-warning/30 bg-warning-light p-4">
                            <strong className="block text-warning">{t('RevenueDownAlert', { percent: Math.abs(revenueChange).toFixed(1) })}</strong>
                            <span className="text-sm text-muted">{t('RevenueDownHint')}</span>
                        </div>
                    )}
                    {!hasOperationalAlert && (
                        <div className="lg:col-span-2 rounded-xl border border-success/30 bg-success-light p-4 flex items-center gap-3 text-success">
                            <CheckCircle2 size={22} />
                            <span>{t('NoOperationalAlerts')}</span>
                        </div>
                    )}
                </div>
            </section>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Today Sales */}
                <div className="stat-card">
                    <div className="stat-icon bg-accent-light">
                        <ShoppingBag size={24} className="text-accent" />
                    </div>
                    <div>
                        <p className="stat-label">{t('SalesToday')}</p>
                        <p className="stat-value">{stats?.today?.sales_count || 0}</p>
                    </div>
                </div>

                {/* Today Revenue */}
                <div className="stat-card">
                    <div className="stat-icon bg-success-light">
                        <DollarSign size={24} className="text-success" />
                    </div>
                    <div>
                        <p className="stat-label">{t('RevenueToday')}</p>
                        <p className="stat-value">
                            {currency.format(stats?.today?.revenue || 0)}
                        </p>
                        {revenueChange !== 0 && (
                            <div className={`flex items-center gap-1 text-sm ${revenueChange > 0 ? 'text-success' : 'text-danger'}`}>
                                {revenueChange > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                <span>{Math.abs(revenueChange).toFixed(1)}% {t('ComparedWithYesterday')}</span>
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
                        <p className="stat-label">{t('RevenueThisMonth')}</p>
                        <p className="stat-value">
                            {currency.format(stats?.month?.revenue || 0)}
                        </p>
                        <p className="text-sm text-muted">
                            {t('SalesCount', { count: stats?.month?.sales_count || 0 })}
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
                        <p className="stat-label">{t('ToReplenish')}</p>
                        <p className="stat-value">
                            {stats?.to_replenish_count ?? stats?.low_stock_count ?? stats?.low_stock?.length ?? 0}
                        </p>
                        <p className="text-sm text-muted">
                            {(stats?.out_of_stock_count ?? 0) > 0 ? (
                                <>
                                    <span className="text-danger font-semibold">{t('IncludingOutOfStock', { count: stats?.out_of_stock_count })}</span>
                                    {(stats?.low_stock_only_count ?? 0) > 0 && (
                                        <span className="text-warning font-semibold">{t('IncludingLowStock', { count: stats?.low_stock_only_count })}</span>
                                    )}
                                </>
                            ) : (
                                t('ProductsToReplenish')
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
                            {t('RevenuePeriod', { period: rangeOptions.find(r => r.value === range)?.label })}
                        </h2>
                        <div className="inline-flex bg-tertiary rounded-lg p-1 text-sm" role="group" aria-label={t('Period')}>
                            {rangeOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setRange(opt.value)}
                                    aria-pressed={range === opt.value}
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
                                <AreaChart role="img" data={stats.revenue_7d} aria-label={t('RevenuePeriod', { period: rangeOptions.find(r => r.value === range)?.label })}>
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
                                        content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />}
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
                                {t('NoSalesLastSevenDays')}
                            </div>
                        )}
                    </div>
                </div>

                {/* Activité par heure aujourd'hui */}
                <div className="card chart-card">
                    <div className="card-header">
                        <h2 className="chart-title">
                            <span className="chart-title-icon"><Activity size={18} /></span>
                            {t('HourlyActivity')}
                        </h2>
                    </div>
                    <div className="card-body">
                        {stats?.hourly_today?.some(h => h.revenue > 0) ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart role="img" data={stats.hourly_today} aria-label={t('HourlyActivity')}>
                                    <CartesianGrid stroke={gridStroke} vertical={false} />
                                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={42} />
                                    <Tooltip
                                        content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />}
                                        cursor={{ fill: 'var(--color-accent-light)' }}
                                    />
                                    <Bar dataKey="revenue" name="CA" fill="#047857" radius={[10, 10, 4, 4]} maxBarSize={38} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="text-center py-12 text-muted">
                                {t('NoSalesToday')}
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
                            {t('TopProductsByQuantity')}
                        </h2>
                    </div>
                    <div className="card-body">
                        <ResponsiveContainer width="100%" height={Math.max(180, stats.top_products.length * 42)}>
                            <BarChart
                                role="img"
                                aria-label={t('TopProductsByQuantity')}
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
                                <Bar dataKey="qty" name={t('Quantity')} fill="#0f766e" radius={[0, 10, 10, 0]} maxBarSize={28} />
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
                            {t('TopProductsThisMonth')}
                        </h2>
                    </div>
                    <div className="card-body p-0">
                        <div className="dashboard-mobile-list">
                            {stats?.top_products?.length ? (
                                stats.top_products.map((p, i) => (
                                    <div key={`mobile-top-${p.product__name ?? i}`} className="mobile-detail-card">
                                        <div className="mobile-detail-card-header">
                                            <div>
                                                <h3>{p.product__name}</h3>
                                                <p>{t('MonthlyProductRank', { rank: i + 1 })}</p>
                                            </div>
                                            <span className="badge badge-accent">x{p.total_qty}</span>
                                        </div>
                                        <div className="mobile-money-grid">
                                            <div>
                                                <span>{t('RevenueShort')}</span>
                                                <strong>{currency.format(p.total_revenue)}</strong>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="mobile-empty-card">{t('NoSalesThisMonth')}</div>
                            )}
                        </div>
                        <table>
                            <caption className="sr-only">{t('TopSellingProductsCaption')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Product')}</th>
                                    <th scope="col" className="text-right">{t('AbbreviatedQuantity')}</th>
                                    <th scope="col" className="text-right">{t('RevenueShort')}</th>
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
                                                {currency.format(p.total_revenue)}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={3} className="text-center text-muted py-8">
                                            {t('NoSalesThisMonth')}
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
                            {t('LowStockAlerts')}
                        </h2>
                        {(stats?.low_stock?.length ?? 0) > 0 && (
                            <button type="button" className="btn-ghost btn-sm" onClick={() => navigate('/inventory?stock=low')}>
                                {t('ViewInventory')} <ChevronRight size={16} />
                            </button>
                        )}
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
                                                    {t('MinimumUnits', { count: product.min_stock })}
                                                </p>
                                                <p className="text-xs text-accent font-semibold mt-1">
                                                    {t('SuggestedRestock', {
                                                        count: getSuggestedRestock(product.stock, product.min_stock),
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className={`badge ${product.stock === 0 ? 'badge-danger' : 'badge-warning'}`}>
                                                {t('UnitsInStock', { count: product.stock })}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-muted">
                                <Package size={48} className="mx-auto mb-4 opacity-30" />
                                <p>{t('AllStockHealthy')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
