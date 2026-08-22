import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import Pagination from '../components/Pagination';
import useCurrency from '../hooks/useCurrency';
import {
    Calculator,
    Package,
    DollarSign
} from 'lucide-react';

const PAGE_SIZE = 50;

interface Product {
    id: number;
    name: string;
    barcode: string;
    category_name: string;
    purchase_price: number;
    stock: number;
    stock_value: number;
}

interface ProductsResponse {
    count: number;
    next: string | null;
    previous: string | null;
    results: Product[];
}

export default function Zakat() {
    const { t } = useTranslation();
    const currency = useCurrency();
    const [page, setPage] = useState(1);

    // Fetch products with pagination
    const { data: productsData, isLoading, isError: productsError, refetch: refetchProducts } = useQuery<ProductsResponse>({
        queryKey: ['products-zakat', page],
        queryFn: () => client.get(`/inventory/products/?page=${page}`).then(res => res.data),
        placeholderData: previous => previous,
    });

    // Fetch stock stats using optimized backend endpoint (database aggregation)
    const { data: statsData, isLoading: isLoadingStats, isError: statsError, refetch: refetchStats } = useQuery<{
        total_products: number;
        stock_value: number;
    }>({
        queryKey: ['products-stats-zakat'],
        queryFn: () => client.get('/inventory/products/stats/').then(res => res.data)
    });

    // Calculate total capital from stats endpoint (optimized for large datasets)
    const totalCapital = statsData?.stock_value || 0;

    // Calculate Zakat (2.5% of capital)
    const zakatAmount = totalCapital * 0.025;

    const products = productsData?.results || [];
    const totalProducts = productsData?.count || 0;
    const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE));

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-primary flex items-center gap-3">
                        <Calculator size={32} />
                        {t('Zakat')}
                    </h1>
                    <p className="text-muted mt-1">{t('ZakatSubtitle')}</p>
                </div>
            </div>

            {/* Total Capital Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-2xl p-6 text-white shadow-lg" style={{ background: 'linear-gradient(135deg, #0f766e 0%, #075985 100%)' }}>
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                            <DollarSign size={32} />
                        </div>
                        <div>
                            <p className="text-white text-sm uppercase tracking-wider">{t('TotalCapital')}</p>
                            {isLoadingStats ? (
                                <div className="h-10 flex items-center">
                                    <div className="loader w-6 h-6 border-2 border-white/30 border-t-white"></div>
                                </div>
                            ) : statsError ? (
                                <p className="text-lg font-bold">{t('DataUnavailable')}</p>
                            ) : (
                                <p className="text-4xl font-bold">{currency.format(totalCapital)}</p>
                            )}
                            <p className="text-white text-sm mt-1">
                                {t('CapitalFormula')}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl p-6 text-white shadow-lg" style={{ background: 'linear-gradient(135deg, #075985 0%, #0f766e 100%)' }}>
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                            <Calculator size={32} />
                        </div>
                        <div>
                            <p className="text-white text-sm uppercase tracking-wider">{t('ZakatRateLabel')}</p>
                            {isLoadingStats ? (
                                <div className="h-10 flex items-center">
                                    <div className="loader w-6 h-6 border-2 border-white/30 border-t-white"></div>
                                </div>
                            ) : statsError ? (
                                <p className="text-lg font-bold">{t('CalculationUnavailable')}</p>
                            ) : (
                                <p className="text-4xl font-bold">{currency.format(zakatAmount)}</p>
                            )}
                            <p className="text-white text-sm mt-1">
                                {t('AmountToPay')}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {statsError && (
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">{t('ZakatCalculationUnavailable')}</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetchStats()}>{t('Retry')}</button>
                </div>
            )}

            {/* Product count */}
            <div className="card p-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <Package size={20} className="text-muted" />
                    <span className="text-muted">
                        {t('TotalProductsCount', { count: totalProducts })}
                    </span>
                </div>
                <span className="text-sm text-muted">{t('ProductsPerPage', { count: PAGE_SIZE })}</span>
            </div>

            {/* Products Table */}
            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="table-premium w-full">
                        <caption className="sr-only">{t('StockValueCaption')}</caption>
                        <thead>
                            <tr>
                                <th scope="col" className="text-left">{t('Product')}</th>
                                <th scope="col" className="text-left">{t('Category')}</th>
                                <th scope="col" className="text-right">{t('Quantity')}</th>
                                <th scope="col" className="text-right">{t('PurchasePrice')}</th>
                                <th scope="col" className="text-right">{t('TotalValue')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12">
                                        <div className="loader mx-auto" aria-hidden="true"></div>
                                        <p className="mt-4 text-muted" role="status" aria-live="polite">{t('Loading')}</p>
                                    </td>
                                </tr>
                            ) : productsError ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12">
                                        <div className="network-error-state" role="alert">
                                            <p>{t('ProductsLoadFailed')}</p>
                                            <button type="button" className="btn-secondary mt-4" onClick={() => void refetchProducts()}>{t('Retry')}</button>
                                        </div>
                                    </td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12 text-muted">
                                        {t('NoProducts')}
                                    </td>
                                </tr>
                            ) : (
                                products.map((product) => {
                                    const totalValue = product.stock_value;
                                    return (
                                        <tr key={product.id} className="hover:bg-tertiary/10 transition-colors">
                                            <td>
                                                <div>
                                                    <p className="font-semibold">{product.name}</p>
                                                    <p className="text-xs text-muted">{product.barcode}</p>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="badge badge-accent">{product.category_name || '-'}</span>
                                            </td>
                                            <td className="text-right font-mono">
                                                {product.stock}
                                            </td>
                                            <td className="text-right font-mono">
                                                {currency.format(product.purchase_price)}
                                            </td>
                                            <td className="text-right font-mono font-bold text-primary">
                                                {currency.format(totalValue)}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                        {products.length > 0 && (
                            <tfoot>
                                <tr className="bg-tertiary/20 font-bold">
                                    <td colSpan={4} className="text-right">
                                        {t('PageTotal')}
                                    </td>
                                    <td className="text-right font-mono text-primary">
                                        {currency.format(products.reduce((sum, product) => sum + product.stock_value, 0))}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {!productsError && (
                <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalItems={totalProducts}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                />
            )}
        </div>
    );
}
