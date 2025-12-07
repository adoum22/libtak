import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import { useTranslation } from 'react-i18next';
import {
    TrendingUp,
    ShoppingBag,
    AlertTriangle,
    DollarSign,
    ArrowUpRight,
    ArrowDownRight,
    Package
} from 'lucide-react';

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
    low_stock: Array<{
        id: number;
        name: string;
        stock: number;
        min_stock: number;
    }>;
}

export default function Dashboard() {
    const { t } = useTranslation();

    const { data: stats, isLoading } = useQuery<StatsData>({
        queryKey: ['dashboardStats'],
        queryFn: () => client.get('/reporting/stats/').then(res => res.data),
        refetchInterval: 30000 // Refresh every 30s
    });

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

                {/* Low Stock */}
                <div
                    onClick={() => document.getElementById('low-stock-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="stat-card cursor-pointer hover:scale-105 transition-transform"
                >
                    <div className="stat-icon bg-danger-light">
                        <AlertTriangle size={24} className="text-danger" />
                    </div>
                    <div>
                        <p className="stat-label">Stock bas</p>
                        <p className="stat-value">{stats?.low_stock?.length || 0}</p>
                        <p className="text-sm text-muted">produits à réapprovisionner</p>
                    </div>
                </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top Products */}
                <div className="card">
                    <div className="card-header flex items-center justify-between">
                        <h2 className="text-lg font-semibold">🏆 Top Produits (ce mois)</h2>
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
                                        <tr key={i}>
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
                        <h2 className="text-lg font-semibold">⚠️ Alertes Stock Bas</h2>
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
