import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import { useState } from 'react';
import { useToast } from '../components/ToastContext';
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

    const { data: report, isLoading, isError, refetch } = useQuery<ReportData>({
        queryKey: ['report', reportType, selectedDate, weekOffset, selectedMonth],
        queryFn: () => client.get(`/reporting/${reportType}/${getQueryParams()}`).then(res => res.data)
    });

    const handleDownload = async (format?: 'xlsx') => {
        try {
            const fmtQuery = format ? `&format=${format}` : '';
            const response = await client.get(
                `/reporting/export_pdf/${getQueryParams()}&type=${reportType}${fmtQuery}`,
                { responseType: 'blob' }
            );

            // Détecter le type réel renvoyé. CORS expose pas toujours
            // le header content-type via axios -> on lit aussi blob.type
            // qui est posé par le navigateur depuis la réponse.
            const blobType: string = (response.data as Blob)?.type || '';
            const headerType: string = String(response.headers?.['content-type'] ?? '');
            const contentType = blobType || headerType;
            const isExcel = contentType.includes('spreadsheetml')
                || contentType.includes('officedocument')
                || format === 'xlsx';
            const ext = isExcel ? 'xlsx' : 'pdf';
            const blob = new Blob([response.data], { type: contentType || undefined });

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `Rapport_${reportType}_${new Date().toISOString().split('T')[0]}.${ext}`
            );
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            toast.error('Le rapport n’a pas pu être téléchargé. Réessayez.');
        }
    };

    const handleDownloadPDF = () => handleDownload();
    const handleDownloadExcel = () => handleDownload('xlsx');

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Rapports de Ventes</h1>
                {report && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleDownloadPDF}
                            className="btn-outline flex items-center gap-2 text-primary border-primary hover:bg-primary hover:text-white"
                            title="PDF si disponible, sinon Excel automatiquement"
                        >
                            <Download size={20} />
                            <span>Télécharger PDF</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadExcel}
                            className="btn-outline flex items-center gap-2 text-success border-success hover:bg-success hover:text-white"
                            title="Forcer l'export Excel"
                        >
                            <Download size={20} />
                            <span>Excel</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Report Type Selector */}
            <div className="card p-4">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex bg-tertiary rounded-lg p-1" role="tablist" aria-label="Type de rapport">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={reportType === 'daily'}
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
                            type="button"
                            role="tab"
                            aria-selected={reportType === 'weekly'}
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
                            type="button"
                            role="tab"
                            aria-selected={reportType === 'monthly'}
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
                                    type="button"
                                    onClick={() => {
                                        const date = new Date(selectedDate);
                                        date.setDate(date.getDate() - 1);
                                        setSelectedDate(date.toISOString().split('T')[0]);
                                    }}
                                    className="btn-secondary btn-icon"
                                    title="Jour précédent"
                                    aria-label="Jour précédent"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <input
                                    aria-label="Date du rapport"
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="w-auto"
                                />
                                <button
                                    type="button"
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
                                    aria-label="Jour suivant"
                                    disabled={selectedDate >= new Date().toISOString().split('T')[0]}
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        )}

                        {reportType === 'weekly' && (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setWeekOffset(w => w + 1)}
                                    className="btn-secondary btn-icon"
                                    aria-label="Semaine précédente"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <span className="px-4">
                                    {weekOffset === 0 ? 'Cette semaine' : `Il y a ${weekOffset} semaine(s)`}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
                                    className="btn-secondary btn-icon"
                                    disabled={weekOffset === 0}
                                    aria-label="Semaine suivante"
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        )}

                        {reportType === 'monthly' && (
                            <div className="flex items-center gap-2">
                                <select
                                    aria-label="Mois du rapport"
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
                                    aria-label="Année du rapport"
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
                <div className="text-center py-12 text-muted" role="status">Chargement…</div>
            ) : isError ? (
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">Le rapport n’a pas pu être chargé.</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>Réessayer</button>
                </div>
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
                            <div className="h-[300px] w-full" role="img" aria-label="Évolution du chiffre d’affaires sur la période sélectionnée">
                                <ResponsiveContainer
                                    width="100%"
                                    height="100%"
                                    initialDimension={{ width: 1, height: 1 }}
                                >
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
                        <div className="reports-mobile-items">
                            {report.items_sold?.length ? (
                                report.items_sold.map((item, i) => (
                                    <div key={`mobile-${item.barcode ?? item.name ?? i}`} className="mobile-detail-card">
                                        <div className="mobile-detail-card-header">
                                            <div>
                                                <h3>{item.name}</h3>
                                                <p>{item.barcode || 'Sans code-barres'}</p>
                                            </div>
                                            <span className="badge badge-accent">x{item.quantity}</span>
                                        </div>
                                        <div className="mobile-money-grid">
                                            <div>
                                                <span>Prix</span>
                                                <strong>{item.unit_price?.toFixed(2) || '-'} DH</strong>
                                            </div>
                                            <div>
                                                <span>Total</span>
                                                <strong>{item.revenue?.toFixed(2)} DH</strong>
                                            </div>
                                            <div>
                                                <span>Marge</span>
                                                <strong className="text-success">{item.profit?.toFixed(2)} DH</strong>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="mobile-empty-card">Aucune vente pour cette période</div>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table>
                                <caption className="sr-only">Articles vendus pendant la période sélectionnée</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Produit</th>
                                        <th scope="col" className="text-right">Prix moyen vendu</th>
                                        <th scope="col" className="text-center">Qté</th>
                                        <th scope="col" className="text-right">Total</th>
                                        <th scope="col" className="text-right">Marge</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.items_sold?.length ? (
                                        report.items_sold.map((item, i) => (
                                            <tr key={item.barcode ?? item.name ?? i}>
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
