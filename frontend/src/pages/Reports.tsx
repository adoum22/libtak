import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import { useState } from 'react';
import { useToast } from '../components/Toast';
import {
    FileText,
    Calendar,
    TrendingUp,
    DollarSign,
    Package,
    ChevronLeft,
    ChevronRight,
    Download
} from 'lucide-react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

interface ReportData {
    date?: string;
    period_start?: string;
    period_end?: string;
    total_sales: number;
    total_revenue: number;
    total_profit: number;
    returns_count?: number;
    total_returns?: number;
    gross_revenue?: number;
    items_sold: Array<{
        name: string;
        barcode: string;
        quantity: number;
        unit_price?: number;
        revenue: number;
        profit: number;
    }>;
    chart_data?: Array<{
        label: string;
        revenue: number;
        count: number;
    }>;
}

export default function Reports() {
    const toast = useToast();
    const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [weekOffset, setWeekOffset] = useState(0);
    const [selectedMonth, setSelectedMonth] = useState({
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
    });

    const getQueryParams = () => {
        switch (reportType) {
            case 'daily':
                return `?date=${selectedDate}`;
            case 'weekly':
                return `?week_offset=${weekOffset}`;
            case 'monthly':
                return `?month=${selectedMonth.month}&year=${selectedMonth.year}`;
            default:
                return '';
        }
    };

    const { data: report, isLoading } = useQuery<ReportData>({
        queryKey: ['report', reportType, selectedDate, weekOffset, selectedMonth],
        queryFn: () => client.get(`/reporting/${reportType}/${getQueryParams()}`).then(res => res.data)
    });

    const handleDownloadPDF = async () => {
        try {
            const response = await client.get(`/reporting/export_pdf/${getQueryParams()}&type=${reportType}`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Rapport_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error: any) {
            console.error('Erreur lors du téléchargement du PDF', error);
            const message = error.response?.data?.detail || error.message || 'Erreur lors du téléchargement du PDF';
            toast.error('Erreur : ' + message);
        }
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Rapports de Ventes</h1>
                {report && (
                    <button
                        onClick={handleDownloadPDF}
                        className="btn-outline flex items-center gap-2 text-primary border-primary hover:bg-primary hover:text-white"
                    >
                        <Download size={20} />
                        <span>Télécharger PDF</span>
                    </button>
                )}
            </div>

            {/* Report Type Selector */}
            <div className="card p-4">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex bg-tertiary rounded-lg p-1">
                        <button
                            onClick={() => {
                                setReportType('daily');
                                setSelectedDate(new Date().toISOString().split('T')[0]);
                            }}
                            className={`px-4 py-2 rounded-md transition ${reportType === 'daily' ? 'bg-accent text-white' : 'hover:bg-hover'
                                }`}
                        >
                            Journalier
                        </button>
                        <button
                            onClick={() => {
                                setReportType('weekly');
                                setWeekOffset(0);
                            }}
                            className={`px-4 py-2 rounded-md transition ${reportType === 'weekly' ? 'bg-accent text-white' : 'hover:bg-hover'
                                }`}
                        >
                            Hebdomadaire
                        </button>
                        <button
                            onClick={() => {
                                setReportType('monthly');
                                setSelectedMonth({
                                    month: new Date().getMonth() + 1,
                                    year: new Date().getFullYear()
                                });
                            }}
                            className={`px-4 py-2 rounded-md transition ${reportType === 'monthly' ? 'bg-accent text-white' : 'hover:bg-hover'
                                }`}
                        >
                            Mensuel
                        </button>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                        {reportType === 'daily' && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        const date = new Date(selectedDate);
                                        date.setDate(date.getDate() - 1);
                                        setSelectedDate(date.toISOString().split('T')[0]);
                                    }}
                                    className="btn-secondary btn-icon"
                                    title="Jour précédent"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="w-auto"
                                />
                                <button
                                    onClick={() => {
                                        const date = new Date(selectedDate);
                                        date.setDate(date.getDate() + 1);
                                        // Empêcher d'aller dans le futur si nécessaire, mais l'utilisateur n'a pas précisé.
                                        // On laisse libre pour l'instant ou on peut bloquer à aujourd'hui.
                                        // Le user veut "naviguer facilement". 
                                        if (date <= new Date()) {
                                            setSelectedDate(date.toISOString().split('T')[0]);
                                        }
                                    }}
                                    className="btn-secondary btn-icon"
                                    title="Jour suivant"
                                    disabled={selectedDate >= new Date().toISOString().split('T')[0]}
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        )}

                        {reportType === 'weekly' && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setWeekOffset(w => w + 1)}
                                    className="btn-secondary btn-icon"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <span className="px-4">
                                    {weekOffset === 0 ? 'Cette semaine' : `Il y a ${weekOffset} semaine(s)`}
                                </span>
                                <button
                                    onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
                                    className="btn-secondary btn-icon"
                                    disabled={weekOffset === 0}
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        )}

                        {reportType === 'monthly' && (
                            <div className="flex items-center gap-2">
                                <select
                                    value={selectedMonth.month}
                                    onChange={(e) => setSelectedMonth({ ...selectedMonth, month: parseInt(e.target.value) })}
                                    className="w-auto"
                                >
                                    {Array.from({ length: 12 }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>
                                            {new Date(2000, i, 1).toLocaleString('fr-FR', { month: 'long' })}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    value={selectedMonth.year}
                                    onChange={(e) => setSelectedMonth({ ...selectedMonth, year: parseInt(e.target.value) })}
                                    className="w-auto"
                                >
                                    {Array.from({ length: 5 }, (_, i) => {
                                        const year = new Date().getFullYear() - i;
                                        return <option key={year} value={year}>{year}</option>;
                                    })}
                                </select>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="text-center py-12 text-muted">Chargement...</div>
            ) : report ? (
                <>
                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="stat-card">
                            <div className="stat-icon bg-accent-light">
                                <FileText size={24} className="text-accent" />
                            </div>
                            <div>
                                <p className="stat-label">Nombre de ventes</p>
                                <p className="stat-value">{report.total_sales}</p>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon bg-success-light">
                                <DollarSign size={24} className="text-success" />
                            </div>
                            <div>
                                <p className="stat-label">Chiffre d'affaires</p>
                                <p className="stat-value">{report.total_revenue?.toLocaleString('fr-FR')} DH</p>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon bg-warning-light">
                                <TrendingUp size={24} className="text-warning" />
                            </div>
                            <div>
                                <p className="stat-label">Bénéfice net</p>
                                <p className="stat-value text-success">{report.total_profit?.toLocaleString('fr-FR')} DH</p>
                            </div>
                        </div>

                        {/* Retours - Affiché seulement s'il y en a */}
                        {report.returns_count && report.returns_count > 0 && (
                            <div className="stat-card border-2 border-red-200">
                                <div className="stat-icon bg-red-100">
                                    <TrendingUp size={24} className="text-red-500 rotate-180" />
                                </div>
                                <div>
                                    <p className="stat-label">Retours ({report.returns_count})</p>
                                    <p className="stat-value text-red-500">-{report.total_returns?.toLocaleString('fr-FR')} DH</p>
                                    {report.gross_revenue && (
                                        <p className="text-xs text-muted mt-1">CA brut: {report.gross_revenue.toLocaleString('fr-FR')} DH</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Charts Section */}
                    {report.chart_data && report.chart_data.length > 0 && (
                        <div className="card p-6">
                            <h2 className="text-lg font-semibold mb-6">Évolution du Chiffre d'Affaires</h2>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={report.chart_data}>
                                        <defs>
                                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#1e40af" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#1e40af" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="label"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#6b7280', fontSize: 12 }}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#6b7280', fontSize: 12 }}
                                            tickFormatter={(value) => `${value} DH`}
                                        />
                                        <Tooltip
                                            formatter={(value) => [`${value} DH`, 'Chiffre d\'Affaires']}
                                            labelStyle={{ color: '#111827', fontWeight: 'bold' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="revenue"
                                            stroke="#1e40af"
                                            fillOpacity={1}
                                            fill="url(#colorRevenue)"
                                            strokeWidth={2}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Items Sold Table */}
                    <div className="card">
                        <div className="card-header">
                            <h2 className="font-semibold text-lg flex items-center gap-2">
                                <Package size={20} />
                                Articles vendus
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Produit</th>
                                        <th className="text-right">Prix Unit.</th>
                                        <th className="text-center">Qté</th>
                                        <th className="text-right">Total</th>
                                        <th className="text-right">Marge</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.items_sold?.length ? (
                                        report.items_sold.map((item, i) => (
                                            <tr key={i}>
                                                <td className="font-medium">{item.name}</td>
                                                <td className="text-right">{item.unit_price?.toFixed(2) || '-'} DH</td>
                                                <td className="text-center">
                                                    <span className="badge badge-accent">{item.quantity}</span>
                                                </td>
                                                <td className="text-right">{item.revenue?.toFixed(2)} DH</td>
                                                <td className="text-right text-success font-medium">
                                                    {item.profit?.toFixed(2)} DH
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="text-center py-8 text-muted">
                                                Aucune vente pour cette période
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            ) : (
                <div className="text-center py-12 text-muted">
                    <Calendar size={48} className="mx-auto mb-4 opacity-30" />
                    <p>Sélectionnez une période pour afficher le rapport</p>
                </div>
            )}
        </div>
    );
}
