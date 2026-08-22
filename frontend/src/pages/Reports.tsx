import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useState, type KeyboardEvent } from 'react';
import { useToast } from '../components/ToastContext';
import PremiumChartTooltip from '../components/PremiumChartTooltip';
import useCurrency from '../hooks/useCurrency';
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
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
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
            toast.error(t('ReportDownloadFailed'));
        }
    };

    const handleDownloadPDF = () => handleDownload();
    const handleDownloadExcel = () => handleDownload('xlsx');

    const handleReportTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tablist = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
        const tabs = tablist
            ? Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
            : [];
        if (!tabs.length) return;

        event.preventDefault();
        const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
        let nextIndex = currentIndex;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else {
            const visualDelta = event.key === 'ArrowRight' ? 1 : -1;
            const delta = document.documentElement.dir === 'rtl' ? -visualDelta : visualDelta;
            nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
        }
        tabs[nextIndex]?.focus();
        tabs[nextIndex]?.click();
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t('SalesReports')}</h1>
                {report && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleDownloadPDF}
                            className="btn-outline flex items-center gap-2 text-primary border-primary hover:bg-primary hover:text-white"
                            title={t('DownloadPdfFallback')}
                        >
                            <Download size={20} />
                            <span>{t('DownloadPDF')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadExcel}
                            className="btn-outline flex items-center gap-2 text-success border-success hover:bg-success hover:text-white"
                            title={t('ForceExcelExport')}
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
                    <div className="flex bg-tertiary rounded-lg p-1" role="tablist" aria-label={t('ReportType')}>
                        <button
                            type="button"
                            role="tab"
                            id="reports-tab-daily"
                            aria-selected={reportType === 'daily'}
                            aria-controls="reports-panel"
                            tabIndex={reportType === 'daily' ? 0 : -1}
                            onKeyDown={handleReportTabKeyDown}
                            onClick={() => {
                                setReportType('daily');
                                setSelectedDate(new Date().toISOString().split('T')[0]);
                            }}
                            className={`px-4 py-2 rounded-md transition ${reportType === 'daily' ? 'bg-accent text-white' : 'hover:bg-hover'
                                }`}
                        >
                            {t('Daily')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="reports-tab-weekly"
                            aria-selected={reportType === 'weekly'}
                            aria-controls="reports-panel"
                            tabIndex={reportType === 'weekly' ? 0 : -1}
                            onKeyDown={handleReportTabKeyDown}
                            onClick={() => {
                                setReportType('weekly');
                                setWeekOffset(0);
                            }}
                            className={`px-4 py-2 rounded-md transition ${reportType === 'weekly' ? 'bg-accent text-white' : 'hover:bg-hover'
                                }`}
                        >
                            {t('Weekly')}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="reports-tab-monthly"
                            aria-selected={reportType === 'monthly'}
                            aria-controls="reports-panel"
                            tabIndex={reportType === 'monthly' ? 0 : -1}
                            onKeyDown={handleReportTabKeyDown}
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
                            {t('Monthly')}
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
                                    title={t('PreviousDay')}
                                    aria-label={t('PreviousDay')}
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <input
                                    aria-label={t('ReportDate')}
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
                                    title={t('NextDay')}
                                    aria-label={t('NextDay')}
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
                                    aria-label={t('PreviousWeek')}
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <span className="px-4">
                                    {weekOffset === 0 ? t('ThisWeek') : t('WeeksAgo', { count: weekOffset })}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
                                    className="btn-secondary btn-icon"
                                    disabled={weekOffset === 0}
                                    aria-label={t('NextWeek')}
                                >
                                    <ChevronRight size={20} />
                                </button>
                            </div>
                        )}

                        {reportType === 'monthly' && (
                            <div className="flex items-center gap-2">
                                <select
                                    aria-label={t('ReportMonth')}
                                    value={selectedMonth.month}
                                    onChange={(e) => setSelectedMonth({ ...selectedMonth, month: parseInt(e.target.value) })}
                                    className="w-auto"
                                >
                                    {Array.from({ length: 12 }, (_, i) => (
                                        <option key={i + 1} value={i + 1}>
                                            {new Date(2000, i, 1).toLocaleString(i18n.language, { month: 'long' })}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    aria-label={t('ReportYear')}
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

            <div
                id="reports-panel"
                role="tabpanel"
                aria-labelledby={`reports-tab-${reportType}`}
                tabIndex={0}
            >
            {isLoading ? (
                <div className="text-center py-12 text-muted" role="status">{t('Loading')}</div>
            ) : isError ? (
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">{t('ReportLoadFailed')}</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button>
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
                                <p className="stat-label">{t('NumberOfSales')}</p>
                                <p className="stat-value">{report.total_sales}</p>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon bg-success-light">
                                <DollarSign size={24} className="text-success" />
                            </div>
                            <div>
                                <p className="stat-label">{t('Turnover')}</p>
                                <p className="stat-value">{currency.format(report.total_revenue)}</p>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon bg-warning-light">
                                <TrendingUp size={24} className="text-warning" />
                            </div>
                            <div>
                                <p className="stat-label">{t('NetProfit')}</p>
                                <p className="stat-value text-success">{currency.format(report.total_profit)}</p>
                            </div>
                        </div>

                        {/* Retours - Affiché seulement s'il y en a */}
                        {report.returns_count && report.returns_count > 0 && (
                            <div className="stat-card border-2 border-red-200">
                                <div className="stat-icon bg-red-100">
                                    <TrendingUp size={24} className="text-red-500 rotate-180" />
                                </div>
                                <div>
                                    <p className="stat-label">{t('ReturnsCount', { count: report.returns_count })}</p>
                                    <p className="stat-value text-red-500">{currency.format(-Number(report.total_returns || 0))}</p>
                                    {report.gross_revenue && (
                                        <p className="text-xs text-muted mt-1">{t('GrossRevenue', { amount: currency.format(report.gross_revenue) })}</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Charts Section */}
                    {report.chart_data && report.chart_data.length > 0 && (
                        <div className="card p-6">
                            <h2 className="text-lg font-semibold mb-6">{t('RevenueEvolution')}</h2>
                            <div className="h-[300px] w-full" role="img" aria-label={t('RevenueEvolutionLabel')}>
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
                                            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
                                            tickFormatter={(value) => `${value} ${currency.symbol}`}
                                        />
                                        <Tooltip content={<PremiumChartTooltip valueSuffix={` ${currency.symbol}`} />} />
                                        <Area
                                            type="monotone"
                                            dataKey="revenue"
                                            name={t('Turnover')}
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
                                {t('ItemsSold')}
                            </h2>
                        </div>
                        <div className="reports-mobile-items">
                            {report.items_sold?.length ? (
                                report.items_sold.map((item, i) => (
                                    <div key={`mobile-${item.barcode ?? item.name ?? i}`} className="mobile-detail-card">
                                        <div className="mobile-detail-card-header">
                                            <div>
                                                <h3>{item.name}</h3>
                                                <p>{item.barcode || t('NoBarcode')}</p>
                                            </div>
                                            <span className="badge badge-accent">x{item.quantity}</span>
                                        </div>
                                        <div className="mobile-money-grid">
                                            <div>
                                                <span>{t('Price')}</span>
                                                <strong>{item.unit_price == null ? '-' : currency.format(item.unit_price)}</strong>
                                            </div>
                                            <div>
                                                <span>{t('Total')}</span>
                                                <strong>{currency.format(item.revenue)}</strong>
                                            </div>
                                            <div>
                                                <span>{t('Margin')}</span>
                                                <strong className="text-success">{currency.format(item.profit)}</strong>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="mobile-empty-card">{t('NoSalesForPeriod')}</div>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table>
                                <caption className="sr-only">{t('ItemsSoldCaption')}</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">{t('Product')}</th>
                                        <th scope="col" className="text-right">{t('AverageSalePrice')}</th>
                                        <th scope="col" className="text-center">{t('AbbreviatedQuantity')}</th>
                                        <th scope="col" className="text-right">{t('Total')}</th>
                                        <th scope="col" className="text-right">{t('Margin')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.items_sold?.length ? (
                                        report.items_sold.map((item, i) => (
                                            <tr key={item.barcode ?? item.name ?? i}>
                                                <td className="font-medium">{item.name}</td>
                                                <td className="text-right">{item.unit_price == null ? '-' : currency.format(item.unit_price)}</td>
                                                <td className="text-center">
                                                    <span className="badge badge-accent">{item.quantity}</span>
                                                </td>
                                                <td className="text-right">{currency.format(item.revenue)}</td>
                                                <td className="text-right text-success font-medium">
                                                    {currency.format(item.profit)}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="text-center py-8 text-muted">
                                                {t('NoSalesForPeriod')}
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
                    <p>{t('SelectPeriodForReport')}</p>
                </div>
            )}
            </div>
        </div>
    );
}
