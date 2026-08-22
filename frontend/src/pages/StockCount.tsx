import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import Pagination from '../components/Pagination';
import {
    ClipboardCheck,
    Plus,
    Search,
    Check,
    Save,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    stock: number;
}

interface CountItem {
    id: number;
    product: number;
    product_name?: string;
    product_barcode?: string;
    expected_quantity: number;
    counted_quantity: number | null;
    difference: number | null;
}

interface InventoryCount {
    id: number;
    name: string;
    status: string;
    status_display: string;
    notes: string;
    items: CountItem[];
    created_at: string;
    completed_at: string | null;
}

interface InventoryCountsPage {
    count: number;
    results: InventoryCount[];
}

const PAGE_SIZE = 50;

const fetchAllProducts = async (): Promise<Product[]> => {
    const products: Product[] = [];
    let nextUrl: string | null = '/inventory/products/?page=1';
    while (nextUrl) {
        const response = await client.get(nextUrl);
        if (Array.isArray(response.data)) return response.data;
        products.push(...(response.data?.results ?? []));
        const next = response.data?.next as string | null | undefined;
        nextUrl = next ? `${new URL(next, window.location.origin).pathname}${new URL(next, window.location.origin).search}` : null;
    }
    return products;
};

export default function StockCount() {
    const { t, i18n } = useTranslation();
    const statusLabel = (status: string, fallback: string) => ({
        IN_PROGRESS: t('InProgress'),
        COMPLETED: t('Completed'),
        VALIDATED: t('Validated'),
    }[status] || fallback);
    const queryClient = useQueryClient();
    const toast = useToast();

    const [showForm, setShowForm] = useState(false);
    const [page, setPage] = useState(1);
    const [expandedCount, setExpandedCount] = useState<number | null>(null);
    const [countName, setCountName] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
    const [searchProduct, setSearchProduct] = useState('');
    const [countedValues, setCountedValues] = useState<Record<number, number>>({});
    const [countMode, setCountMode] = useState<'total' | 'add'>('total');
    const [createQuantities, setCreateQuantities] = useState<Record<number, number>>({}); // Quantités lors de création

    // Fetch counts
    const { data: countsPage, isLoading, isError: countsError, refetch: refetchCounts } = useQuery<InventoryCountsPage>({
        queryKey: ['inventoryCounts', page],
        queryFn: () => client.get('/inventory/counts/', { params: { page } }).then(res => ({
            count: Number(res.data?.count ?? (Array.isArray(res.data) ? res.data.length : 0)),
            results: res.data?.results ?? (Array.isArray(res.data) ? res.data : []),
        })),
        placeholderData: previous => previous,
    });
    const counts = countsPage?.results ?? [];
    const countsTotal = countsPage?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(countsTotal / PAGE_SIZE));

    // Search products
    const { data: products = [], isError: productsError } = useQuery<Product[]>({
        queryKey: ['products', searchProduct],
        queryFn: () => client.get(`/inventory/products/?search=${searchProduct}`).then(res => res.data.results || res.data),
        enabled: searchProduct.length > 1
    });

    // All products for counting
    const { data: allProducts = [], isLoading: allProductsLoading, isError: allProductsError, refetch: refetchAllProducts } = useQuery<Product[]>({
        queryKey: ['allProducts'],
        queryFn: fetchAllProducts,
    });

    // Create count
    const createCount = useMutation({
        mutationFn: (data: { name: string; items: { product: number; expected_quantity: number }[] }) =>
            client.post('/inventory/counts/', data),
        onSuccess: () => {
            toast.success(t('StockCountCreated'));
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
            resetForm();
        },
        onError: (error: unknown) => {
            const msg = getApiErrorMessage(error, t('StockCountCreateFailed'));
            toast.error(t('OperationError', { message: msg }));
        }
    });

    // Update count (save counted values) - FIX: Use POST on /update_counts/ endpoint
    const updateCount = useMutation({
        mutationFn: ({ id, items }: { id: number; items: { id: number; counted_quantity: number }[] }) =>
            client.post(`/inventory/counts/${id}/update_counts/`, { items }),
        onSuccess: () => {
            toast.success(t('CountSaved'));
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
        },
        onError: (error: unknown) => {
            const msg = getApiErrorMessage(error, t('CountSaveFailed'));
            toast.error(msg);
        }
    });

    // Complete count
    const completeCount = useMutation({
        mutationFn: (id: number) => client.post(`/inventory/counts/${id}/complete/`),
        onSuccess: () => {
            toast.success(t('StockCountCompleted'));
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
        }
    });

    // Validate count (apply adjustments)
    const validateCount = useMutation({
        mutationFn: (id: number) => client.post(`/inventory/counts/${id}/validate/`),
        onSuccess: () => {
            toast.success(t('StockCountApplied'));
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
        }
    });

    const resetForm = () => {
        setCountName('');
        setSelectedProducts([]);
        setShowForm(false);
        setSearchProduct('');
        setCreateQuantities({});
    };

    const addProduct = (product: Product) => {
        if (!selectedProducts.find(p => p.id === product.id)) {
            setSelectedProducts([...selectedProducts, product]);
        }
        setSearchProduct('');
    };

    const addAllProducts = () => {
        if (allProductsError) {
            toast.error(t('FullProductListUnavailable'));
            return;
        }
        setSelectedProducts(allProducts);
    };

    const handleCreate = () => {
        if (!countName.trim() || selectedProducts.length === 0) {
            toast.error(t('NameAndProductsRequired'));
            return;
        }

        // Vérifier qu'au moins une quantité est saisie
        const hasQuantities = selectedProducts.some(p => createQuantities[p.id] !== undefined);
        if (!hasQuantities) {
            toast.error(t('AtLeastOneQuantity'));
            return;
        }

        // Préparer les items avec les quantités calculées
        const items = selectedProducts
            .filter(p => createQuantities[p.id] !== undefined)
            .map(p => {
                const inputQty = createQuantities[p.id] || 0;
                // Calculer la quantité comptée selon le mode
                const counted = countMode === 'add' ? p.stock + inputQty : inputQty;
                return {
                    product: p.id,
                    expected_quantity: p.stock,
                    counted_quantity: counted
                };
            });

        createCount.mutate({
            name: countName,
            items
        });
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            IN_PROGRESS: 'badge-warning',
            COMPLETED: 'badge-info',
            VALIDATED: 'badge-success'
        };
        return styles[status] || 'badge-secondary';
    };

    const getDifferenceClass = (diff: number | null) => {
        if (diff === null) return 'text-muted';
        if (diff === 0) return 'text-success';
        if (diff < 0) return 'text-danger';
        return 'text-warning';
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <ClipboardCheck className="text-accent" />
                        {t('StockCount')}
                    </h1>
                    <p className="text-muted mt-1">{t('StockCountSubtitle')}</p>
                </div>
                <button type="button" onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2" aria-expanded={showForm} aria-controls="stock-count-form">
                    <Plus size={18} />
                    {t('NewStockCount')}
                </button>
            </div>

            {/* Create Form */}
            {showForm && (
                <div id="stock-count-form" className="card p-6 border-accent border-2">
                    <h2 className="text-xl font-bold mb-4">{t('NewStockCount')}</h2>

                    <div className="mb-4">
                        <label htmlFor="stock-count-name" className="block text-sm font-medium mb-1">{t('InventoryName')} *</label>
                        <input
                            id="stock-count-name"
                            type="text"
                            value={countName}
                            onChange={(e) => setCountName(e.target.value)}
                            className="input w-full"
                            placeholder={t('InventoryNameExample')}
                        />
                    </div>

                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium">{t('ProductsToCount')}</label>
                            <button type="button" onClick={addAllProducts} disabled={allProductsLoading || allProductsError} className="btn-sm btn-secondary">
                                {allProductsLoading ? t('Loading') : t('AddAllProducts')}
                            </button>
                        </div>
                        {allProductsError && (
                            <div className="text-sm text-danger mb-2" role="alert">
                                {t('FullListUnavailable')}{' '}
                                <button type="button" className="btn-ghost btn-sm" onClick={() => void refetchAllProducts()}>{t('Retry')}</button>
                            </div>
                        )}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                            <input
                                aria-label={t('SearchProductToCount')}
                                type="text"
                                placeholder={t('SearchProductPlaceholder')}
                                className="input w-full pl-10"
                                value={searchProduct}
                                onChange={(e) => setSearchProduct(e.target.value)}
                            />
                            {products.length > 0 && searchProduct && (
                                <div className="absolute top-full left-0 right-0 bg-secondary border border-border rounded-lg shadow-2xl z-50 max-h-48 overflow-auto mt-1" role="listbox">
                                    {products.map(p => (
                                        <button
                                            type="button"
                                            key={p.id}
                                            className="w-full p-3 hover:bg-tertiary border-b last:border-b-0 text-left"
                                            onClick={() => addProduct(p)}
                                            role="option"
                                        >
                                            <div className="font-medium text-primary">{p.name}</div>
                                            <div className="text-xs text-muted">{p.barcode} - {t('CurrentStockValue', { stock: p.stock })}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {productsError && searchProduct.length > 1 && <p className="text-sm text-danger mt-2" role="alert">{t('ProductSearchUnavailable')}</p>}
                        </div>
                    </div>

                    {selectedProducts.length > 0 && (
                        <div className="mb-4">
                            {/* Mode selector */}
                            <div className="flex items-center gap-4 mb-4 p-3 bg-accent-light/20 rounded-lg">
                                <span className="text-sm font-medium">{t('Mode')}</span>
                                <div className="flex bg-tertiary rounded-lg p-1" role="group" aria-label={t('CountEntryMode')}>
                                    <button
                                        type="button"
                                        onClick={() => setCountMode('total')}
                                        aria-pressed={countMode === 'total'}
                                        className={`px-3 py-1 rounded text-sm transition ${countMode === 'total' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                    >
                                        {t('TotalCountedQuantity')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCountMode('add')}
                                        aria-pressed={countMode === 'add'}
                                        className={`px-3 py-1 rounded text-sm transition ${countMode === 'add' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                    >
                                        {t('QuantityToAdd')}
                                    </button>
                                </div>
                            </div>
                            <p className="text-sm font-medium mb-2">
                                {t('SelectedProductsCount', { count: selectedProducts.length, instruction: countMode === 'total' ? t('EnterTotalStock') : t('EnterQuantityToAdd') })}
                            </p>
                            <div className="space-y-2 max-h-64 overflow-auto">
                                {selectedProducts.map(p => (
                                    <div key={p.id} className="flex flex-wrap items-center gap-4 p-3 bg-tertiary rounded">
                                        <span className="flex-1 font-medium">{p.name}</span>
                                        <span className="text-sm text-muted">{t('CurrentStockLabel', { stock: p.stock })}</span>
                                        <input
                                            aria-label={t(countMode === 'total' ? 'TotalStockForProduct' : 'QuantityToAddForProduct', { product: p.name })}
                                            type="number"
                                            min={0}
                                            placeholder={countMode === 'total' ? t('TotalPlaceholder') : t('AddPlaceholder')}
                                            className="input w-24 text-center"
                                            value={createQuantities[p.id] ?? ''}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 0;
                                                setCreateQuantities({ ...createQuantities, [p.id]: val });
                                            }}
                                        />
                                        {countMode === 'add' && createQuantities[p.id] !== undefined && (
                                            <span className="text-xs text-success font-bold w-16 text-right">
                                                → {p.stock + (createQuantities[p.id] || 0)}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedProducts(selectedProducts.filter(x => x.id !== p.id));
                                                const newQty = { ...createQuantities };
                                                delete newQty[p.id];
                                                setCreateQuantities(newQty);
                                            }}
                                            className="text-danger hover:bg-danger/20 rounded p-1"
                                            aria-label={t('RemoveFromCount', { product: p.name })}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button type="button" onClick={handleCreate} disabled={createCount.isPending} className="btn-primary flex-1">
                            {createCount.isPending ? t('Creating') : t('CreateStockCount')}
                        </button>
                        <button type="button" onClick={resetForm} className="btn-secondary">{t('Cancel')}</button>
                    </div>
                </div>
            )}

            {/* Counts List */}
            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold">{t('StockCountHistory')}</h2>
                </div>
                <div className="divide-y">
                    {isLoading ? (
                        <div className="p-8 text-center text-muted" role="status">{t('Loading')}</div>
                    ) : countsError ? (
                        <div className="network-error-state m-4" role="alert"><p>{t('StockCountsLoadFailed')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchCounts()}>{t('Retry')}</button></div>
                    ) : counts.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <ClipboardCheck size={48} className="mx-auto mb-4 opacity-50" />
                            <p>{t('NoStockCounts')}</p>
                        </div>
                    ) : (
                        counts.map((count) => (
                            <div key={count.id} className="p-4">
                                <button
                                    type="button"
                                    className="w-full flex items-center justify-between text-left bg-transparent p-0"
                                    onClick={() => setExpandedCount(expandedCount === count.id ? null : count.id)}
                                    aria-expanded={expandedCount === count.id}
                                    aria-controls={`stock-count-details-${count.id}`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-tertiary rounded-full flex items-center justify-center">
                                            <ClipboardCheck size={20} className="text-muted" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{count.name}</p>
                                            <p className="text-sm text-muted">
                                                {new Date(count.created_at).toLocaleDateString(i18n.language)} • {t('ProductsCountShort', { count: count.items?.length || 0 })}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`badge ${getStatusBadge(count.status)}`}>
                                            {statusLabel(count.status, count.status_display || count.status)}
                                        </span>
                                        {expandedCount === count.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </button>

                                {/* Quick summary - always visible for VALIDATED */}
                                {count.status === 'VALIDATED' && expandedCount !== count.id && count.items && count.items.length > 0 && (
                                    <div className="mt-2 ml-14 text-sm">
                                        <div className="flex flex-wrap gap-2">
                                            {count.items.slice(0, 3).map((item) => (
                                                <span key={item.id} className="bg-tertiary px-2 py-1 rounded text-xs">
                                                    <span className="font-semibold text-muted mr-1">{item.product_barcode}</span>
                                                    {item.product_name}: {item.expected_quantity} → <span className="font-bold">{item.counted_quantity}</span>
                                                    {item.difference !== 0 && (
                                                        <span className={item.difference && item.difference > 0 ? 'text-success' : 'text-danger'}>
                                                            {' '}({item.difference && item.difference > 0 ? '+' : ''}{item.difference})
                                                        </span>
                                                    )}
                                                </span>
                                            ))}
                                            {count.items.length > 3 && (
                                                <span className="text-muted text-xs">{t('MoreItems', { count: count.items.length - 3 })}</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted mt-1">{t('ClickForAllDetails')}</p>
                                    </div>
                                )}

                                {expandedCount === count.id && (
                                    <div id={`stock-count-details-${count.id}`} className="mt-4 pl-14 space-y-3">
                                        {/* Items to count */}
                                        {count.status === 'IN_PROGRESS' && (
                                            <div className="space-y-2">
                                                {/* Mode selector */}
                                                <div className="flex items-center gap-4 mb-4 p-3 bg-accent-light/20 rounded-lg">
                                                    <span className="text-sm font-medium">{t('CountEntryMode')}:</span>
                                                    <div className="flex bg-tertiary rounded-lg p-1" role="group" aria-label={t('StockEntryMode')}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCountMode('total')}
                                                            aria-pressed={countMode === 'total'}
                                                            className={`px-3 py-1 rounded text-sm transition ${countMode === 'total' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                                        >
                                                            {t('TotalQuantity')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCountMode('add')}
                                                            aria-pressed={countMode === 'add'}
                                                            className={`px-3 py-1 rounded text-sm transition ${countMode === 'add' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                                        >
                                                            {t('AddToStock')}
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-sm font-medium">
                                                    {countMode === 'total'
                                                        ? t('EnterTotalCountedStock')
                                                        : t('EnterQuantityToAddPrompt')}
                                                </p>
                                                {count.items?.map((item) => (
                                                    <div key={item.id} className="flex flex-wrap items-center gap-4 p-2 bg-tertiary rounded">
                                                        <span className="flex-1">{item.product_name || t('FallbackProductNumber', { id: item.product })}</span>
                                                        <span className="text-sm text-muted">{t('CurrentStockLabel', { stock: item.expected_quantity })}</span>
                                                        <input
                                                            aria-label={t(countMode === 'total' ? 'TotalStockForProduct' : 'QuantityToAddForProduct', { product: item.product_name || t('FallbackProductNumber', { id: item.product }) })}
                                                            type="number"
                                                            min={0}
                                                            placeholder={countMode === 'total' ? t('TotalCountedQuantity') : t('AddPlaceholder')}
                                                            className="input w-28 text-center"
                                                            value={countedValues[item.id] ?? ''}
                                                            onChange={(e) => {
                                                                const inputVal = parseInt(e.target.value) || 0;
                                                                let finalVal = inputVal;
                                                                if (countMode === 'add') {
                                                                    // Si mode ajout, on calcule le total
                                                                    finalVal = item.expected_quantity + inputVal;
                                                                }
                                                                setCountedValues({
                                                                    ...countedValues,
                                                                    [item.id]: finalVal
                                                                });
                                                            }}
                                                        />
                                                        {countMode === 'add' && countedValues[item.id] !== undefined && (
                                                            <span className="text-xs text-success font-bold">
                                                                → {countedValues[item.id]}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                                <div className="flex gap-2 pt-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateCount.mutate({
                                                            id: count.id,
                                                            items: Object.entries(countedValues).map(([id, qty]) => ({
                                                                id: parseInt(id),
                                                                counted_quantity: qty
                                                            }))
                                                        })}
                                                        className="btn-secondary flex items-center gap-1"
                                                    >
                                                        <Save size={16} /> {t('SaveCount')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => completeCount.mutate(count.id)}
                                                        className="btn-primary flex items-center gap-1"
                                                    >
                                                        <Check size={16} /> {t('FinishCount')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Completed - show differences */}
                                        {count.status === 'COMPLETED' && (
                                            <div>
                                                <p className="text-sm font-medium mb-2">{t('DifferencesFound')}</p>
                                                <div className="space-y-1">
                                                    {count.items?.map((item) => (
                                                        <div key={item.id} className="flex items-center justify-between p-2 bg-tertiary rounded text-sm">
                                                            <div className="flex flex-col">
                                                                <span>{item.product_name}</span>
                                                                <span className="text-xs text-muted">{item.product_barcode}</span>
                                                            </div>
                                                            <div className="flex items-center gap-4">
                                                                <span>{t('Expected', { count: item.expected_quantity })}</span>
                                                                <span>{t('CountedValue', { count: item.counted_quantity })}</span>
                                                                <span className={`font-bold ${getDifferenceClass(item.difference)}`}>
                                                                    {item.difference !== null && (
                                                                        item.difference > 0 ? `+${item.difference}` : item.difference
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => validateCount.mutate(count.id)}
                                                    className="btn-success flex items-center gap-1 mt-3"
                                                >
                                                    <Check size={16} /> {t('ValidateAdjustStock')}
                                                </button>
                                            </div>
                                        )}

                                        {/* Validated - show summary with details */}
                                        {count.status === 'VALIDATED' && (
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2 text-success">
                                                    <Check size={18} />
                                                    <span className="font-medium">{t('StockCountValidated')}</span>
                                                </div>
                                                <div className="border border-success/30 rounded-lg overflow-hidden">
                                                    <div className="bg-success/10 px-3 py-2 text-sm font-medium border-b border-success/30">
                                                        {t('AdjustmentSummary', { count: count.items?.length || 0 })}
                                                    </div>
                                                    <div className="divide-y divide-border">
                                                        {count.items?.map((item) => (
                                                            <div key={item.id} className="flex items-center justify-between p-3 text-sm hover:bg-tertiary/50">
                                                                <div className="flex-1">
                                                                    <p className="font-medium">{item.product_name}</p>
                                                                    <p className="text-xs text-muted">{item.product_barcode}</p>
                                                                </div>
                                                                <div className="flex items-center gap-6 text-right">
                                                                    <div>
                                                                        <span className="text-muted text-xs block">{t('Before')}</span>
                                                                        <span>{item.expected_quantity}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted text-xs block">{t('After')}</span>
                                                                        <span className="font-bold">{item.counted_quantity}</span>
                                                                    </div>
                                                                    <div className="w-16">
                                                                        <span className="text-muted text-xs block">{t('Difference')}</span>
                                                                        <span className={`font-bold ${getDifferenceClass(item.difference)}`}>
                                                                            {item.difference !== null && item.difference !== 0
                                                                                ? (item.difference > 0 ? `+${item.difference}` : item.difference)
                                                                                : '0'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                {count.completed_at && (
                                                    <p className="text-xs text-muted">
                                                        {t('ValidatedAt', { date: new Date(count.completed_at).toLocaleDateString(i18n.language), time: new Date(count.completed_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
                {!isLoading && !countsError && (
                    <Pagination currentPage={page} totalPages={totalPages} totalItems={countsTotal} pageSize={PAGE_SIZE} onPageChange={nextPage => { setExpandedCount(null); setPage(nextPage); }} />
                )}
            </div>
        </div>
    );
}
