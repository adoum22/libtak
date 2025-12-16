import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import {
    Calculator,
    Package,
    ChevronLeft,
    ChevronRight,
    DollarSign
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    category_name: string;
    purchase_price: number;
    stock: number;
}

interface ProductsResponse {
    count: number;
    next: string | null;
    previous: string | null;
    results: Product[];
}

export default function Zakat() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    // Fetch products with pagination
    const { data: productsData, isLoading } = useQuery<ProductsResponse>({
        queryKey: ['products-zakat', page, pageSize],
        queryFn: () => client.get(`/inventory/products/?page=${page}&page_size=${pageSize}`).then(res => res.data)
    });

    // Fetch stock stats using optimized backend endpoint (database aggregation)
    const { data: statsData, isLoading: isLoadingStats } = useQuery<{
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
    const totalPages = Math.ceil(totalProducts / pageSize);

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent flex items-center gap-3">
                        <Calculator size={32} />
                        Zakat
                    </h1>
                    <p className="text-muted mt-1">Calcul du capital et de la Zakat</p>
                </div>
            </div>

            {/* Total Capital Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card bg-gradient-to-br from-primary to-primary/80 text-white p-6">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                            <DollarSign size={32} />
                        </div>
                        <div>
                            <p className="text-white/80 text-sm uppercase tracking-wider">Capital Total</p>
                            {isLoadingStats ? (
                                <div className="h-10 flex items-center">
                                    <div className="loader w-6 h-6 border-2 border-white/30 border-t-white"></div>
                                </div>
                            ) : (
                                <p className="text-4xl font-bold">{totalCapital.toFixed(2)} <span className="text-lg">MAD</span></p>
                            )}
                            <p className="text-white/60 text-sm mt-1">
                                Somme (Quantité × Prix d'Achat)
                            </p>
                        </div>
                    </div>
                </div>

                <div className="card bg-gradient-to-br from-accent to-accent/80 text-white p-6">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                            <Calculator size={32} />
                        </div>
                        <div>
                            <p className="text-white/80 text-sm uppercase tracking-wider">Zakat (2.5%)</p>
                            {isLoadingStats ? (
                                <div className="h-10 flex items-center">
                                    <div className="loader w-6 h-6 border-2 border-white/30 border-t-white"></div>
                                </div>
                            ) : (
                                <p className="text-4xl font-bold">{zakatAmount.toFixed(2)} <span className="text-lg">MAD</span></p>
                            )}
                            <p className="text-white/60 text-sm mt-1">
                                Montant à verser
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Page Size Selector */}
            <div className="card p-4 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <Package size={20} className="text-muted" />
                    <span className="text-muted">
                        <strong>{totalProducts}</strong> produits au total
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted">Afficher :</span>
                    <select
                        value={pageSize}
                        onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                        }}
                        className="input py-1 px-3 w-20"
                    >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                    <span className="text-sm text-muted">par page</span>
                </div>
            </div>

            {/* Products Table */}
            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="table-premium w-full">
                        <thead>
                            <tr>
                                <th className="text-left">Produit</th>
                                <th className="text-left">Catégorie</th>
                                <th className="text-right">Quantité</th>
                                <th className="text-right">Prix d'Achat</th>
                                <th className="text-right">Valeur Totale</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12">
                                        <div className="loader mx-auto"></div>
                                        <p className="mt-4 text-muted">Chargement...</p>
                                    </td>
                                </tr>
                            ) : products.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12 text-muted">
                                        Aucun produit trouvé
                                    </td>
                                </tr>
                            ) : (
                                products.map((product) => {
                                    const totalValue = product.stock * product.purchase_price;
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
                                                {product.purchase_price.toFixed(2)} MAD
                                            </td>
                                            <td className="text-right font-mono font-bold text-primary">
                                                {totalValue.toFixed(2)} MAD
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
                                        Total de cette page :
                                    </td>
                                    <td className="text-right font-mono text-primary">
                                        {products.reduce((sum, p) => sum + (p.stock * p.purchase_price), 0).toFixed(2)} MAD
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="btn-ghost btn-icon disabled:opacity-50"
                    >
                        <ChevronLeft size={20} />
                    </button>

                    <div className="flex gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum;
                            if (totalPages <= 5) {
                                pageNum = i + 1;
                            } else if (page <= 3) {
                                pageNum = i + 1;
                            } else if (page >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                            } else {
                                pageNum = page - 2 + i;
                            }
                            return (
                                <button
                                    key={pageNum}
                                    onClick={() => setPage(pageNum)}
                                    className={`w-10 h-10 rounded-lg font-medium transition-all ${page === pageNum
                                        ? 'bg-primary text-white shadow-lg'
                                        : 'bg-tertiary/20 hover:bg-tertiary/40'
                                        }`}
                                >
                                    {pageNum}
                                </button>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="btn-ghost btn-icon disabled:opacity-50"
                    >
                        <ChevronRight size={20} />
                    </button>

                    <span className="text-sm text-muted ml-4">
                        Page {page} sur {totalPages}
                    </span>
                </div>
            )}
        </div>
    );
}
