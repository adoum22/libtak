import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage, getApiErrorStatus } from '../api/client';
import { useToast } from '../components/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { normalizeDecimalInput } from '../utils/numberInput';
import useCurrency from '../hooks/useCurrency';
import {
    Plus,
    Search,
    Edit,
    Trash2,
    Package,
    AlertTriangle,
    X,
    Save,
    Image as ImageIcon,
    Truck,
    AlertCircle,
    Banknote,
    ScanLine,
    Upload,
    FileCheck2,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    description: string;
    purchase_price?: number;
    sale_price_ht: number;
    price_ttc: number;
    stock: number;
    min_stock: number;
    category: number | null;
    category_name: string | null;
    supplier: number | null;
    supplier_name: string | null;
    profit_margin?: number;
    is_low_stock: boolean;
    image_url: string | null;
    cost_layers?: StockLayer[];
}

interface StockLayer {
    id: number;
    initial_quantity: number;
    remaining_quantity: number;
    unit_cost: string | number;
    created_at: string;
    note?: string;
}

interface Category {
    id: number;
    name: string;
}

interface Supplier {
    id: number;
    name: string;
}

type StockFilter = 'all' | 'low' | 'out';

interface ImportPreview {
    dry_run: true;
    valid_rows: number;
    would_create: number;
    would_update: number;
    would_skip: number;
    errors: string[];
}

interface ImportRequest {
    file: File;
    upsert: boolean;
}

export default function Inventory() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { t, i18n } = useTranslation();
    const currency = useCurrency();
    const [searchParams] = useSearchParams();
    const [search, setSearch] = useState('');
    const [purchasePriceFilter, setPurchasePriceFilter] = useState('');
    const [stockFilter, setStockFilter] = useState<StockFilter>(() => {
        const requestedFilter = searchParams.get('stock');
        return requestedFilter === 'low' || requestedFilter === 'out' ? requestedFilter : 'all';
    });
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
    const [productToDeactivate, setProductToDeactivate] = useState<Product | null>(null);
    const [priceDraft, setPriceDraft] = useState({ purchase_price: '', sale_price_ht: '' });
    const [layerDrafts, setLayerDrafts] = useState<Record<number, { unit_cost: string; note: string }>>({});
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [targetProductId, setTargetProductId] = useState<number | null>(null);
    const [viewingImageProduct, setViewingImageProduct] = useState<Product | null>(null);
    const listFileInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: '',
        barcode: '',
        description: '',
        purchase_price: '',
        sale_price_ht: '',
        stock: '0',
        min_stock: '5',
        category: '',
        supplier: ''
    });

    const { data: productsData, isLoading, error, refetch: refetchProducts } = useQuery<{ results?: Product[]; count?: number; next?: string | null; previous?: string | null } | Product[]>({
        queryKey: ['products', search, stockFilter, purchasePriceFilter, page],
        queryFn: () => {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (purchasePriceFilter) params.set('purchase_price', purchasePriceFilter.replace(',', '.'));
            if (stockFilter === 'low') params.set('low_stock', 'true');
            if (stockFilter === 'out') params.set('stock_status', 'out');
            params.set('page', String(page));
            return client.get(`/inventory/products/?${params.toString()}`).then(res => res.data);
        },
    });

    const isPaginated = productsData && !Array.isArray(productsData);
    const rawProducts: Product[] = isPaginated
        ? (productsData as { results?: Product[] }).results ?? []
        : (productsData as Product[]) ?? [];
    const purchasePriceTarget = purchasePriceFilter.trim() === ''
        ? null
        : Number(purchasePriceFilter.replace(',', '.'));
    const priceMatches = (value: string | number | null | undefined) =>
        purchasePriceTarget === null || (
            Number.isFinite(purchasePriceTarget)
            && Math.abs(Number(value ?? 0) - purchasePriceTarget) < 0.005
        );
    const productMatchesPurchasePrice = (product: Product) =>
        purchasePriceTarget === null
        || priceMatches(product.purchase_price)
        || Boolean(product.cost_layers?.some(layer => priceMatches(layer.unit_cost)));
    const layerMatchesPurchasePrice = (layer: StockLayer) =>
        purchasePriceTarget !== null && priceMatches(layer.unit_cost);
    const products = rawProducts.filter(productMatchesPurchasePrice);
    const hasInvalidSalePrice = (product: Product) => Number(product.price_ttc) <= 0;
    const invalidSalePriceCount = products.filter(hasInvalidSalePrice).length;
    const totalCount: number = purchasePriceTarget !== null
        ? products.length
        : isPaginated ? (productsData as { count?: number }).count ?? products.length : products.length;
    const hasNext: boolean = isPaginated ? Boolean((productsData as { next?: string | null }).next) : false;
    const hasPrev: boolean = isPaginated ? Boolean((productsData as { previous?: string | null }).previous) : false;
    const PAGE_SIZE = 50;
    const pageStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const pageEnd = Math.min(page * PAGE_SIZE, totalCount);

    // Reset à la page 1 quand on change de filtre/recherche
    const setStockFilterReset = (f: StockFilter) => { setStockFilter(f); setPage(1); };
    const setSearchReset = (s: string) => { setSearch(s); setPage(1); };
    const setPurchasePriceFilterReset = (s: string) => { setPurchasePriceFilter(normalizeDecimalInput(s)); setPage(1); };

    const { data: categoriesData, isError: categoriesError, refetch: refetchCategories } = useQuery({
        queryKey: ['categories'],
        queryFn: () => client.get('/inventory/categories/').then(res => res.data)
    });

    const categories: Category[] = categoriesData?.results || categoriesData || [];

    const { data: suppliersData, isError: suppliersError, refetch: refetchSuppliers } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => res.data)
    });

    const suppliers: Supplier[] = suppliersData?.results || suppliersData || [];

    const buildFormData = (data: typeof formData, image: File | null) => {
        const payload = new FormData();
        payload.append('name', data.name);
        payload.append('barcode', data.barcode);
        payload.append('description', data.description);
        if (isAdmin) {
            payload.append('purchase_price', normalizeMoney(data.purchase_price) || '0');
        }
        payload.append('sale_price_ht', normalizeMoney(data.sale_price_ht));
        payload.append('tva', '0');
        payload.append('stock', data.stock);
        payload.append('min_stock', data.min_stock);

        if (data.category) payload.append('category', data.category);
        if (data.supplier) payload.append('supplier', data.supplier);

        if (image) {
            payload.append('image', image);
        }
        return payload;
    };

    const createMutation = useMutation({
        mutationFn: (payload: FormData) => client.post('/inventory/products/', payload, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            closeModal();
        },
        onError: (error: unknown) => {
            toast.error(t('ProductCreateError', { message: getApiErrorMessage(error) }));
        }
    });

    const updateMutation = useMutation({
        mutationFn: (data: { id: number; payload: FormData }) =>
            client.patch(`/inventory/products/${data.id}/`, data.payload, {
                headers: { 'Content-Type': 'multipart/form-data' }
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            closeModal();
        },
        onError: (error: unknown) => {
            const detail = getApiErrorMessage(error);
            toast.error(t('ProductUpdateError', { message: detail }));
        }
    });

    const priceMutation = useMutation({
        mutationFn: (data: { id: number; purchase_price: string; sale_price_ht: string }) =>
            client.patch(`/inventory/products/${data.id}/`, {
                purchase_price: normalizeMoney(data.purchase_price) || '0',
                sale_price_ht: normalizeMoney(data.sale_price_ht) || '0',
            }),
        onSuccess: (response) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setViewingProduct(response.data);
            openProductDetails(response.data);
            toast.success(t('ProductPriceUpdated'));
        },
        onError: (error: unknown) => {
            toast.error(t('ProductPriceError', { message: getApiErrorMessage(error) }));
        }
    });

    const normalizeMoney = (value: string) => normalizeDecimalInput(value).trim();

    const layerMutation = useMutation({
        mutationFn: async (data: { productId: number; id?: number; index: number; unit_cost: string; note: string }) => {
            const url = data.id
                ? `/inventory/products/${data.productId}/cost-layers/${data.id}/`
                : `/inventory/products/${data.productId}/cost-layers/by-position/${data.index}/`;
            const payload = {
                layer_id: data.id,
                index: data.index,
                unit_cost: normalizeMoney(data.unit_cost) || '0',
                note: data.note || '',
            };

            try {
                return await client.patch(`/inventory/products/${data.productId}/update-cost-layer/`, payload);
            } catch (error) {
                if (getApiErrorStatus(error) !== 404) throw error;
            }

            try {
                return await client.patch(url, payload);
            } catch (error) {
                if (getApiErrorStatus(error) !== 404) throw error;
            }

            if (data.id) {
                try {
                    return await client.patch(`/inventory/product-cost-layers/${data.id}/`, payload);
                } catch (error) {
                    if (getApiErrorStatus(error) !== 404) throw error;
                }
            }

            return client.patch(
                `/inventory/products/${data.productId}/cost-layers/by-position/${data.index}/`,
                payload,
            );
        },
        onSuccess: (response, variables) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            if (response.data?.product) {
                openProductDetails(response.data.product);
            } else {
                setViewingProduct(prev => {
                    if (!prev?.cost_layers) return prev;
                    return {
                        ...prev,
                        cost_layers: prev.cost_layers.map((layer, index) =>
                            (variables.id ? layer.id === variables.id : index === variables.index)
                                ? { ...layer, unit_cost: normalizeMoney(variables.unit_cost), note: variables.note }
                                : layer
                        ),
                    };
                });
            }
            toast.success(t('FifoBatchUpdated'));
        },
        onError: (error: unknown) => {
            toast.error(t('FifoBatchError', { message: getApiErrorMessage(error, t('FifoBatchFallback')) }));
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => client.delete(`/inventory/products/${id}/`),
        onSuccess: () => {
            setProductToDeactivate(null);
            toast.success(t('ProductDeactivated'));
            queryClient.invalidateQueries({ queryKey: ['products'] });
        },
        onError: (error: unknown) => {
            toast.error(t('ProductDeactivateFailed', { message: getApiErrorMessage(error) }));
        },
    });

    const importExcelFileRef = useRef<HTMLInputElement | null>(null);
    const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
    const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
    const [importUpsert, setImportUpsert] = useState(false);

    const closeImportPreview = () => {
        setPendingImportFile(null);
        setImportPreview(null);
        setImportUpsert(false);
    };

    const previewImportMutation = useMutation({
        mutationFn: ({ file, upsert }: ImportRequest) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('dry_run', 'true');
            formData.append('upsert', String(upsert));
            return client.post<ImportPreview>('/inventory/products/import_excel/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (response) => setImportPreview(response.data),
        onError: (error: unknown) => {
            setImportPreview(null);
            toast.error(t('ImportPreviewFailed', { message: getApiErrorMessage(error) }));
        },
    });

    const previewImport = (file: File, upsert: boolean) => {
        setPendingImportFile(file);
        setImportPreview(null);
        previewImportMutation.mutate({ file, upsert });
    };

    const importMutation = useMutation({
        mutationFn: ({ file, upsert }: ImportRequest) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('upsert', String(upsert));
            return client.post('/inventory/products/import_excel/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (data: { data: { created: number; updated?: number; images?: number; skipped?: number; errors: unknown[] } }) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            toast.success(t('ImportCompleted', {
                created: data.data.created,
                images: data.data.images || 0,
                updated: data.data.updated || 0,
                skipped: data.data.skipped || 0,
                errors: data.data.errors.length,
            }));
            closeImportPreview();
        },
        onError: (error: unknown) => {
            const detail = getApiErrorMessage(error);
            const responseStatus = getApiErrorStatus(error);
            const status = responseStatus ? ` (Status: ${responseStatus})` : '';
            toast.error(t('ImportError', { status, message: detail }));
        }
    });

    const { data: currentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(res => res.data),
        retry: false,
        staleTime: 60_000,
    });

    // Check permissions - source of truth is the server response, not localStorage
    const isAdmin = currentUser?.role === 'ADMIN';
    const canManageStock = isAdmin || (currentUser?.can_manage_stock === true);

    const openCreateModal = () => {
        if (!canManageStock) return;
        setEditingProduct(null);
        // ... (rest of initial state reset)
        setFormData({
            name: '',
            barcode: '',
            description: '',
            purchase_price: '',
            sale_price_ht: '',
            stock: '0',
            min_stock: '5',
            category: '',
            supplier: ''
        });
        setShowModal(true);
    };

    const openEditModal = (product: Product) => {
        setEditingProduct(product);
        setSelectedImage(null);
        setImagePreview(product.image_url);
        setFormData({
            name: product.name,
            barcode: product.barcode,
            description: product.description || '',
            purchase_price: product.purchase_price?.toString() || '',
            sale_price_ht: product.sale_price_ht?.toString() || '',
            stock: product.stock?.toString() || '0',
            min_stock: product.min_stock?.toString() || '5',
            category: product.category?.toString() || '',
            supplier: product.supplier?.toString() || ''
        });
        setShowModal(true);
    };

    const openProductDetails = (product: Product) => {
        setViewingProduct(product);
        setPriceDraft({
            purchase_price: product.purchase_price?.toString() || '0',
            sale_price_ht: product.sale_price_ht?.toString() || '0',
        });
        const drafts: Record<number, { unit_cost: string; note: string }> = {};
        product.cost_layers?.forEach((layer) => {
            drafts[layer.id] = {
                unit_cost: Number(layer.unit_cost).toString(),
                note: layer.note || '',
            };
        });
        setLayerDrafts(drafts);
    };

    const openAdjacentProduct = (direction: -1 | 1) => {
        if (!viewingProduct || products.length === 0) return;
        const currentIndex = products.findIndex(product => product.id === viewingProduct.id);
        if (currentIndex === -1) return;
        const nextProduct = products[currentIndex + direction];
        if (nextProduct) openProductDetails(nextProduct);
    };

    const closeModal = () => {
        setShowModal(false);
        setEditingProduct(null);
        setSelectedImage(null);
        setImagePreview(null);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setSelectedImage(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    // Direct Upload Handler
    const handleListUploadClick = (productId: number) => {
        setTargetProductId(productId);
        listFileInputRef.current?.click();
    };

    const handleListFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && targetProductId) {
            const file = e.target.files[0];
            const payload = new FormData();
            payload.append('image', file);

            updateMutation.mutate({ id: targetProductId, payload });

            // Reset
            e.target.value = '';
            setTargetProductId(null);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const payload = buildFormData(formData, selectedImage);

        if (editingProduct) {
            updateMutation.mutate({ id: editingProduct.id, payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    return (
        <div className="inventory-page space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t('Inventory')}</h1>
                {canManageStock && (
                    <div className="inventory-actions flex gap-2">
                        {isAdmin && (
                            <>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls,.csv,.zip,application/zip"
                                    className="hidden"
                                    ref={importExcelFileRef}
                                    onChange={(e) => {
                                        if (e.target.files && e.target.files[0]) {
                                            previewImport(e.target.files[0], importUpsert);
                                            e.target.value = ''; // Reset input
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => importExcelFileRef.current?.click()}
                                    className="inventory-import-action btn-secondary flex items-center gap-2"
                                    disabled={importMutation.isPending || previewImportMutation.isPending}
                                >
                                    <Upload size={20} />
                                    <span>{previewImportMutation.isPending ? t('ImportAnalyzing') : t('ImportCsvZip')}</span>
                                </button>
                            </>
                        )}

                        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
                            <Plus size={20} />
                            <span>{t('AddProduct')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Search + Filters */}
            <div className="card p-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[260px] max-w-md">
                    <Search className="inventory-filter-icon absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                    <input
                        type="text"
                        placeholder={t('SearchProducts')}
                        aria-label={t('SearchProducts')}
                        className="inventory-search-input"
                        value={search}
                        onChange={(e) => setSearchReset(e.target.value)}
                    />
                </div>
                {isAdmin && (
                    <div className="relative w-full sm:w-52">
                        <Banknote className="inventory-filter-icon absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                        <input
                            type="text"
                            step="0.01"
                            inputMode="decimal"
                            placeholder={t('PurchasePriceFilter')}
                            aria-label={t('PurchasePriceFilter')}
                            className="inventory-purchase-filter-input"
                            value={purchasePriceFilter}
                            onChange={(e) => setPurchasePriceFilterReset(e.target.value)}
                        />
                        <span className="inventory-filter-suffix absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">{currency.symbol}</span>
                    </div>
                )}
                <div className="flex bg-tertiary rounded-lg p-1" role="group" aria-label={t('StockStatus')}>
                    <button
                        type="button"
                        onClick={() => setStockFilterReset('all')}
                        aria-pressed={stockFilter === 'all'}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${stockFilter === 'all' ? 'bg-secondary shadow text-accent' : 'text-muted hover:text-primary'}`}
                    >
                        {t('All')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setStockFilterReset('low')}
                        aria-pressed={stockFilter === 'low'}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${stockFilter === 'low' ? 'bg-warning text-white shadow' : 'text-muted hover:text-primary'}`}
                    >
                        <AlertTriangle size={14} /> {t('LowStockFilter')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setStockFilterReset('out')}
                        aria-pressed={stockFilter === 'out'}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${stockFilter === 'out' ? 'bg-danger text-white shadow' : 'text-muted hover:text-primary'}`}
                    >
                        <X size={14} /> {t('OutOfStockFilter')}
                    </button>
                </div>
                <span className="text-sm text-muted ml-auto">
                    {t('ProductsTotalCount', { count: totalCount })}
                </span>
            </div>

            {isAdmin && invalidSalePriceCount > 0 && (
                <div className="rounded-xl border border-warning/30 bg-warning-light p-4 text-warning flex items-start gap-3" role="status">
                    <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                        <p className="font-semibold">
                            {t('InvalidSalePricesCount', { count: invalidSalePriceCount })}
                        </p>
                        <p className="text-sm mt-1">
                            {t('InvalidSalePricesHint')}
                        </p>
                    </div>
                </div>
            )}

            <div className="inventory-mobile-list">
                {isLoading ? (
                    <div className="mobile-empty-card" role="status">
                        <div className="animate-spin inline-block w-7 h-7 border-4 border-accent border-t-transparent rounded-full mb-3" />
                        <p>{t('StockLoading')}</p>
                    </div>
                ) : error ? (
                    <div className="mobile-empty-card text-danger" role="alert">
                        <AlertTriangle size={32} className="mx-auto mb-2" />
                        <p>{t('LoadError')}</p>
                        <button type="button" className="btn-secondary mt-3" onClick={() => void refetchProducts()}>{t('Retry')}</button>
                    </div>
                ) : products.length === 0 ? (
                    <div className="mobile-empty-card">
                        <Package size={32} className="mx-auto mb-2 text-muted" />
                        <p>{t('NoProducts')}</p>
                    </div>
                ) : (
                    products.map((product) => (
                        <button
                            key={`mobile-${product.id}`}
                            type="button"
                            onClick={() => openProductDetails(product)}
                            className="inventory-mobile-card"
                        >
                            <div className="inventory-mobile-thumb">
                                {product.image_url ? (
                                    <img src={product.image_url} alt={t('ProductPhotoAlt', { product: product.name })} />
                                ) : (
                                    <Package size={22} />
                                )}
                            </div>
                            <div className="inventory-mobile-info">
                                <div className="inventory-mobile-title-row">
                                    <h3>{product.name}</h3>
                                    <span className={`badge ${product.stock === 0 ? 'badge-danger' : product.is_low_stock ? 'badge-warning' : 'badge-success'}`}>
                                        {product.stock}
                                    </span>
                                </div>
                                <p className="inventory-mobile-barcode">{product.barcode}</p>
                                <div className="inventory-mobile-meta">
                                    {isAdmin && <span>{t('PurchaseShort', { amount: currency.format(product.purchase_price) })}</span>}
                                    <span className={hasInvalidSalePrice(product) ? 'text-danger font-semibold' : ''}>
                                        {t('SaleShort', { amount: currency.format(product.price_ttc) })}
                                    </span>
                                    <span>{t('ThresholdShort', { count: product.min_stock })}</span>
                                </div>
                                {hasInvalidSalePrice(product) && (
                                    <span className="badge badge-danger mt-2">{t('PriceCorrectionRequired')}</span>
                                )}
                                {isAdmin && product.cost_layers && product.cost_layers.length > 0 && (
                                    <div className="inventory-mobile-layers">
                                        {product.cost_layers.slice(0, 2).map((layer, idx) => (
                                            <span key={`mobile-${product.id}-layer-${layer.id}`}>
                                                {t('BatchSummary', { index: idx + 1, remaining: layer.remaining_quantity, initial: layer.initial_quantity, cost: currency.format(layer.unit_cost) })}
                                            </span>
                                        ))}
                                        {product.cost_layers.length > 2 && <span>{t('MoreBatches', { count: product.cost_layers.length - 2 })}</span>}
                                    </div>
                                )}
                            </div>
                        </button>
                    ))
                )}
                {isPaginated && totalCount > 0 && (
                    <div className="mobile-pagination">
                        <button
                            type="button"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={!hasPrev || page === 1}
                            className="btn-secondary disabled:opacity-30"
                        >
                            <ChevronLeft size={18} />
                            {t('Previous')}
                        </button>
                        <span>{t('Page', { page })}</span>
                        <button
                            type="button"
                            onClick={() => setPage(p => p + 1)}
                            disabled={!hasNext}
                            className="btn-secondary disabled:opacity-30"
                        >
                            {t('Next')}
                            <ChevronRight size={18} />
                        </button>
                    </div>
                )}
            </div>

            {/* Products Table */}
            <div className="inventory-table-card card overflow-hidden">
                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="p-8 text-center" role="status">
                            <div className="animate-spin inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full mb-4"></div>
                            <p className="text-muted">{t('Loading')}</p>
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center text-danger" role="alert">
                            <AlertTriangle size={48} className="mx-auto mb-4" />
                            <p className="font-bold">{t('LoadError')}</p>
                            <p className="text-sm text-muted mt-2">{t('CheckConnection')}</p>
                            <button type="button" className="btn-secondary mt-4" onClick={() => void refetchProducts()}>{t('Retry')}</button>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="p-8 text-center">
                            <Package size={48} className="mx-auto mb-4 text-muted" />
                            <p className="font-bold">{t('NoProducts')}</p>
                            <p className="text-sm text-muted mt-2">{t('ClickAddProductHint')}</p>
                        </div>
                    ) : (
                        <table className="inventory-table">
                            <caption className="sr-only">{t('Inventory')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('Product')}</th>
                                    <th scope="col">{t('Barcode')}</th>
                                    <th scope="col">{t('Category')}</th>
                                    {isAdmin && <th scope="col" className="text-right">{t('PurchasePriceColumn')}</th>}
                                    <th scope="col" className="text-right">{t('SalePriceColumn')}</th>
                                    {isAdmin && <th scope="col" className="text-right">{t('Margin')}</th>}
                                    <th scope="col" className="text-center">{t('Stock')}</th>
                                    <th scope="col" className="text-center">{t('Threshold')}</th>
                                    <th scope="col">{t('Supplier')}</th>
                                    {canManageStock && <th scope="col">{t('Actions')}</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((product) => (
                                    <tr key={product.id}>
                                        <td>
                                            <div className="inventory-product-cell flex items-center gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (product.image_url) {
                                                            setViewingImageProduct(product);
                                                        } else {
                                                            handleListUploadClick(product.id);
                                                        }
                                                    }}
                                                    className="w-10 h-10 bg-tertiary rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all relative group"
                                                    title={product.image_url ? t('ViewPhoto') : t('AddPhoto')}
                                                    aria-label={product.image_url ? t('ViewPhoto') : t('AddPhoto')}
                                                >
                                                    {product.image_url ? (
                                                        <>
                                                            <img
                                                                src={product.image_url}
                                                                alt={t('ProductPhotoAlt', { product: product.name })}
                                                                className="w-full h-full object-cover"
                                                            />
                                                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                                <Edit size={12} className="text-white" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Package size={20} className="text-muted group-hover:hidden" />
                                                            <Plus size={20} className="text-accent hidden group-hover:block" />
                                                        </>
                                                    )}
                                                </button>
                                                <div className="inventory-product-copy min-w-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => openProductDetails(product)}
                                                        className="inventory-product-name font-medium text-left hover:text-accent transition-colors"
                                                        title={t('OpenProductDetails')}
                                                    >
                                                        {product.name}
                                                    </button>
                                                    {isAdmin && product.cost_layers && product.cost_layers.length > 0 && (
                                                        <div className="mt-2 space-y-1">
                                                            <p className="text-[10px] uppercase font-semibold text-muted">{t('FifoBatches')}</p>
                                                            <div className="inventory-lots-strip flex flex-wrap gap-1.5">
                                                                {product.cost_layers.slice(0, 3).map((layer, idx) => (
                                                                    <span
                                                                        key={`${product.id}-layer-${idx}`}
                                                                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] border ${
                                                                            layerMatchesPurchasePrice(layer)
                                                                                ? 'bg-accent-light text-accent border-accent/40'
                                                                                : 'bg-tertiary text-muted border-border'
                                                                        }`}
                                                                        title={layer.note || t('BatchFromDate', { date: new Date(layer.created_at).toLocaleDateString(i18n.language) })}
                                                                    >
                                                                        <strong className="text-primary">{t('BatchNumber', { index: idx + 1 })}</strong>
                                                                        {t('PurchaseShort', { amount: currency.format(layer.unit_cost) })}
                                                                        <span className="text-accent font-semibold">
                                                                            {layer.remaining_quantity}/{layer.initial_quantity}
                                                                        </span>
                                                                    </span>
                                                                ))}
                                                                {product.cost_layers.length > 3 && (
                                                                    <span className="text-[11px] text-muted px-2 py-1">
                                                                        {t('MoreBatches', { count: product.cost_layers.length - 3 })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="font-mono text-sm">{product.barcode}</td>
                                        <td>
                                            {product.category_name && (
                                                <span className="badge badge-accent">{product.category_name}</span>
                                            )}
                                        </td>
                                        {isAdmin && <td className="text-right">{currency.format(product.purchase_price)}</td>}
                                        <td className="text-right font-semibold">
                                            <span className={hasInvalidSalePrice(product) ? 'text-danger' : ''}>
                                                {currency.format(product.price_ttc)}
                                            </span>
                                            {hasInvalidSalePrice(product) && (
                                                <span className="block text-[11px] text-danger mt-1">{t('Unsellable')}</span>
                                            )}
                                        </td>
                                        {isAdmin && (
                                            <td className="text-right">
                                                <span className={(product.profit_margin ?? 0) > 0 ? 'text-success' : 'text-danger'}>
                                                    {currency.format(product.profit_margin)}
                                                </span>
                                            </td>
                                        )}
                                        <td className="text-center">
                                            <span className={`badge ${product.stock === 0 ? 'badge-danger' :
                                                product.is_low_stock ? 'badge-warning' : 'badge-success'
                                                }`}>
                                                {product.is_low_stock && <AlertTriangle size={12} className="mr-1" />}
                                                {product.stock}
                                            </span>
                                        </td>
                                        <td className="text-center text-muted font-mono">{product.min_stock}</td>
                                        <td className="text-sm">{product.supplier_name || '-'}</td>
                                        {canManageStock && (
                                            <td>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => openProductDetails(product)}
                                                        className="btn-ghost p-2 text-accent hover:bg-accent-light"
                                                        title={t('OpenPricesAndBatches')}
                                                    >
                                                        <Edit size={18} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setProductToDeactivate(product)}
                                                        className="btn-ghost p-2 text-danger hover:bg-danger-light"
                                                        aria-label={t('DisableProductNamed', { name: product.name })}
                                                        title={t('DisableProduct')}
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Pagination footer */}
                {isPaginated && totalCount > 0 && (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t flex-wrap">
                        <span className="text-sm text-muted">
                            {t('ShowingRange', { start: pageStart, end: pageEnd, total: totalCount })}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={!hasPrev || page === 1}
                                className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                aria-label={t('PreviousPage')}
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="text-sm font-medium">{t('Page', { page })}</span>
                            <button
                                type="button"
                                onClick={() => setPage(p => p + 1)}
                                disabled={!hasNext}
                                className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                aria-label={t('NextPage')}
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black opacity-50 backdrop-blur-sm" onClick={closeModal} />
                    <div
                        className="relative card w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-slideUp p-0"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="inventory-product-modal-title"
                    >
                        {/* Header */}
                        <div className="p-6 border-b flex items-center justify-between bg-secondary sticky top-0 z-10">
                            <h2 id="inventory-product-modal-title" className="text-xl font-bold">
                                {editingProduct ? t('EditProduct') : t('NewProduct')}
                            </h2>
                            <button type="button" data-modal-close onClick={closeModal} className="btn-ghost p-2 -mr-2" aria-label={t('CloseProductWindow')}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-8">

                            {(categoriesError || suppliersError) && (
                                <div className="network-error-state" role="alert">
                                    <p className="font-semibold">
                                        {categoriesError ? t('CategoriesUnavailable') : t('SuppliersUnavailable')}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {categoriesError && <button type="button" className="btn-secondary" onClick={() => void refetchCategories()}>{t('Retry')}</button>}
                                        {suppliersError && <button type="button" className="btn-secondary" onClick={() => void refetchSuppliers()}>{t('Retry')}</button>}
                                    </div>
                                </div>
                            )}

                            {/* Top Section: Image & Basic Info */}
                            <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8">
                                {/* Image Upload Column - Reduced Size */}
                                <div className="w-full flex flex-col items-center">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        aria-label={t('ChooseProductPhoto')}
                                        className="w-full max-w-[220px] aspect-square bg-tertiary rounded-2xl border-2 border-dashed border-border hover:border-accent hover:bg-accent-light/10 transition-colors flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group shrink-0"
                                    >
                                        {imagePreview ? (
                                            <>
                                                <img src={imagePreview} alt={t('ProductPreview')} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-white font-medium flex items-center gap-2">
                                                        <Edit size={20} />
                                                        {t('Edit')}
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center text-muted p-4">
                                                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                                                    <ImageIcon size={32} />
                                                </div>
                                                <p className="font-medium">{t('AddPhoto')}</p>
                                                <p className="text-xs mt-1">{t('ClickToUpload')}</p>
                                            </div>
                                        )}
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleImageChange}
                                        aria-label={t('ChooseProductPhoto')}
                                    />
                                    <p className="text-xs text-muted text-center mt-2">
                                        {t('ImageFormatHint')}
                                    </p>
                                </div>

                                {/* Basic Info Column */}
                                <div className="flex-1 space-y-4">
                                    <div>
                                        <label htmlFor="inventory-product-name" className="block text-sm font-bold mb-2">{t('ProductName')} *</label>
                                        <input
                                            id="inventory-product-name"
                                            type="text"
                                            className="input-lg text-lg font-bold"
                                            placeholder={t('ProductNameExample')}
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="inventory-product-barcode" className="block text-sm font-medium mb-2">{t('Barcode')} *</label>
                                            <div className="relative">
                                                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                                <input
                                                    id="inventory-product-barcode"
                                                    type="text"
                                                    className="pl-12 font-mono"
                                                    value={formData.barcode}
                                                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                                    required
                                                    disabled={!!editingProduct}
                                                    placeholder={t('ScanPlaceholder')}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="inventory-product-category" className="block text-sm font-medium mb-2">{t('Category')}</label>
                                            <select
                                                id="inventory-product-category"
                                                value={formData.category}
                                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                className="w-full p-2.5 bg-secondary border border-border rounded-lg"
                                            >
                                                <option value="">{categoriesError ? t('CategoriesUnavailable') : `-- ${t('Uncategorized')} --`}</option>
                                                {categories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="inventory-product-description" className="block text-sm font-medium mb-2">{t('Description')}</label>
                                        <textarea
                                            id="inventory-product-description"
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={4}
                                            className="w-full resize-none"
                                            placeholder={t('ProductDetailsPlaceholder')}
                                        />
                                    </div>
                                </div>
                            </div>

                            <hr className="border-border" />

                            {/* Middle Section: Logistics & Stock (Highlighted) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-accent-light/10 p-6 rounded-2xl border border-accent/10">
                                    <h3 className="flex items-center gap-2 font-bold text-accent mb-4">
                                        <Truck size={20} />
                                        {t('LogisticsAndSupplier')}
                                    </h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label htmlFor="inventory-product-supplier" className="block text-sm font-bold mb-2">{t('Supplier')}</label>
                                            <select
                                                id="inventory-product-supplier"
                                                value={formData.supplier}
                                                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                                className="w-full p-3 bg-secondary border-2 border-accent/20 rounded-xl focus:border-accent focus:ring-accent"
                                            >
                                                <option value="">{suppliersError ? t('SuppliersUnavailable') : t('SelectSupplier')}</option>
                                                {suppliers.map(sup => (
                                                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label htmlFor="inventory-product-stock" className="block text-sm font-medium mb-2">{t('CurrentStock')}</label>
                                                <input
                                                    id="inventory-product-stock"
                                                    type="number"
                                                    value={formData.stock}
                                                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                                    className="font-bold"
                                                    disabled={!!editingProduct}
                                                />
                                                {editingProduct && (
                                                    <p className="text-[10px] text-muted mt-1">
                                                        {t('StockEditWorkflowHint')}
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label htmlFor="inventory-product-min-stock" className="block text-sm font-medium mb-2 text-danger flex items-center gap-1">
                                                    <AlertCircle size={14} />
                                                    {t('CriticalStock')}
                                                </label>
                                                <input
                                                    id="inventory-product-min-stock"
                                                    type="number"
                                                    value={formData.min_stock}
                                                    onChange={(e) => setFormData({ ...formData, min_stock: e.target.value })}
                                                    className="border-danger/30 focus:border-danger focus:ring-danger bg-danger-light/10"
                                                />
                                                <p className="text-[10px] text-danger mt-1">{t('LowStockThresholdHint')}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-tertiary/30 p-6 rounded-2xl border border-tertiary">
                                    <h3 className="flex items-center gap-2 font-bold text-primary mb-4">
                                        <Banknote size={20} />
                                        {t('PricesAndMargins')}
                                    </h3>

                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            {isAdmin && (
                                                <div>
                                                    <label htmlFor="inventory-product-purchase-price" className="block text-sm font-medium mb-2">{t('PurchasePrice')}</label>
                                                    <div className="relative">
                                                        <input
                                                            id="inventory-product-purchase-price"
                                                            type="text"
                                                            step="0.01"
                                                            value={formData.purchase_price}
                                                            onChange={(e) => setFormData({ ...formData, purchase_price: normalizeDecimalInput(e.target.value) })}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">{currency.symbol}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label htmlFor="inventory-product-sale-price" className="block text-sm font-bold mb-2">{t('SalePrice')} *</label>
                                            <div className="relative">
                                                <input
                                                    id="inventory-product-sale-price"
                                                    type="text"
                                                    step="0.01"
                                                    className="text-lg font-bold border-accent"
                                                    value={formData.sale_price_ht}
                                                    onChange={(e) => setFormData({ ...formData, sale_price_ht: normalizeDecimalInput(e.target.value) })}
                                                    required
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">{currency.symbol}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-6 border-t bg-secondary sticky bottom-0 -mx-6 px-6 pb-2">
                                <button type="button" onClick={closeModal} className="btn-secondary px-6">
                                    {t('Cancel')}
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex items-center gap-2 px-8 text-lg"
                                    disabled={createMutation.isPending || updateMutation.isPending}
                                >
                                    <Save size={20} />
                                    <span>{editingProduct ? t('SaveChanges') : t('CreateProductAction')}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Product Details Modal */}
            {viewingProduct && (
                <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setViewingProduct(null)} />
                    <div
                        className="relative card w-full max-w-6xl max-h-[92vh] overflow-hidden animate-slideUp p-0"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="inventory-product-detail-title"
                    >
                        <div className="p-5 border-b flex items-center justify-between bg-secondary">
                            <div>
                                <h2 id="inventory-product-detail-title" className="text-xl font-bold">{viewingProduct.name}</h2>
                                <p className="text-sm text-muted font-mono">{viewingProduct.barcode}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openAdjacentProduct(-1)}
                                    disabled={products.findIndex(product => product.id === viewingProduct.id) <= 0}
                                    className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                    aria-label={t('PreviousProduct')}
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openAdjacentProduct(1)}
                                    disabled={products.findIndex(product => product.id === viewingProduct.id) === -1 || products.findIndex(product => product.id === viewingProduct.id) >= products.length - 1}
                                    className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                    aria-label={t('NextProduct')}
                                >
                                    <ChevronRight size={20} />
                                </button>
                                <button type="button" data-modal-close onClick={() => setViewingProduct(null)} className="btn-ghost p-2" aria-label={t('Close')}>
                                    <X size={24} />
                                </button>
                            </div>
                        </div>

                        <div className="overflow-y-auto max-h-[calc(92vh-84px)]">
                            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-0">
                                <div className="bg-tertiary/40 p-5 border-r border-border">
                                    <div className="w-full max-w-[240px] aspect-square mx-auto rounded-2xl bg-secondary overflow-hidden border border-border flex items-center justify-center">
                                        {viewingProduct.image_url ? (
                                            <img
                                                src={viewingProduct.image_url}
                                                alt={viewingProduct.name}
                                                className="w-full h-full object-contain"
                                            />
                                        ) : (
                                            <div className="text-center text-muted">
                                                <Package size={64} className="mx-auto mb-3" />
                                                 <p className="font-medium">{t('NoPhoto')}</p>
                                            </div>
                                        )}
                                    </div>
                                    {canManageStock && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleListUploadClick(viewingProduct.id);
                                                setViewingProduct(null);
                                            }}
                                            className="btn-secondary w-full mt-4 flex items-center justify-center gap-2"
                                        >
                                            <Upload size={18} />
                                             {t('ChangePhoto')}
                                        </button>
                                    )}
                                </div>

                                <div className="p-6 space-y-6">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">{t('Stock')}</p>
                                            <p className="text-2xl font-bold">{viewingProduct.stock}</p>
                                        </div>
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">{t('Threshold')}</p>
                                            <p className="text-2xl font-bold">{viewingProduct.min_stock}</p>
                                        </div>
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">{t('Category')}</p>
                                            <p className="font-bold truncate">{viewingProduct.category_name || '-'}</p>
                                        </div>
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">{t('Supplier')}</p>
                                            <p className="font-bold truncate">{viewingProduct.supplier_name || '-'}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                        {isAdmin && (
                                            <div className="rounded-2xl border border-border p-5 bg-secondary">
                                                <h3 className="flex items-center gap-2 font-bold mb-4">
                                                    <Banknote size={20} />
                                                    {t('ProductPrices')}
                                                </h3>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label htmlFor="inventory-detail-purchase-price" className="block text-sm font-medium mb-2">{t('PurchasePrice')}</label>
                                                        <div className="relative">
                                                            <input
                                                                id="inventory-detail-purchase-price"
                                                                 type="text"
                                                                step="0.01"
                                                                value={priceDraft.purchase_price}
                                                                onChange={(e) => setPriceDraft({ ...priceDraft, purchase_price: normalizeDecimalInput(e.target.value) })}
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">{currency.symbol}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label htmlFor="inventory-detail-sale-price" className="block text-sm font-medium mb-2">{t('UniqueSalePrice')}</label>
                                                        <div className="relative">
                                                            <input
                                                                id="inventory-detail-sale-price"
                                                                 type="text"
                                                                step="0.01"
                                                                value={priceDraft.sale_price_ht}
                                                                onChange={(e) => setPriceDraft({ ...priceDraft, sale_price_ht: normalizeDecimalInput(e.target.value) })}
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">{currency.symbol}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => priceMutation.mutate({
                                                        id: viewingProduct.id,
                                                        purchase_price: priceDraft.purchase_price,
                                                        sale_price_ht: priceDraft.sale_price_ht,
                                                    })}
                                                    disabled={priceMutation.isPending}
                                                    className="btn-primary mt-4 flex items-center gap-2"
                                                >
                                                    <Save size={18} />
                                                    {t('SaveProductPrices')}
                                                </button>
                                            </div>
                                        )}

                                        <div className="rounded-2xl border border-border p-5 bg-secondary">
                                            <h3 className="font-bold mb-4">{t('Information')}</h3>
                                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                {isAdmin && (
                                                    <div>
                                                        <dt className="text-muted">{t('DisplayedPurchasePrice')}</dt>
                                                        <dd className="font-bold">{currency.format(viewingProduct.purchase_price)}</dd>
                                                    </div>
                                                )}
                                                <div>
                                                        <dt className="text-muted">{t('CurrentSalePrice')}</dt>
                                                    <dd className="font-bold">{currency.format(viewingProduct.price_ttc || 0)}</dd>
                                                </div>
                                                {isAdmin && (
                                                    <div>
                                                        <dt className="text-muted">{t('DefaultMargin')}</dt>
                                                        <dd className={(viewingProduct.profit_margin ?? 0) > 0 ? 'font-bold text-success' : 'font-bold text-danger'}>
                                                            {currency.format(viewingProduct.profit_margin || 0)}
                                                        </dd>
                                                    </div>
                                                )}
                                                <div>
                                                    <dt className="text-muted">{t('Status')}</dt>
                                                    <dd className="font-bold">{viewingProduct.is_low_stock ? t('LowStockFilter') : t('StockHealthy')}</dd>
                                                </div>
                                            </dl>
                                            {viewingProduct.description && (
                                                <p className="text-sm text-muted mt-4 whitespace-pre-wrap">{viewingProduct.description}</p>
                                            )}
                                        </div>
                                    </div>

                                    {isAdmin && (
                                        <div className="rounded-2xl border border-border bg-secondary overflow-hidden">
                                            <div className="p-5 border-b">
                                                <h3 className="font-bold">{t('ActiveFifoCostBatches')}</h3>
                                                <p className="text-sm text-muted">
                                                    {t('FifoCostExplanation')}
                                                </p>
                                            </div>
                                            {viewingProduct.cost_layers && viewingProduct.cost_layers.length > 0 ? (
                                                <div className="divide-y divide-border">
                                                    {viewingProduct.cost_layers.map((layer, idx) => {
                                                        const draft = layerDrafts[layer.id] || {
                                                            unit_cost: Number(layer.unit_cost).toString(),
                                                            note: layer.note || '',
                                                        };
                                                        return (
                                                            <div
                                                                key={layer.id}
                                                                className={`p-5 grid grid-cols-1 xl:grid-cols-[160px_1fr_auto] gap-4 items-end ${
                                                                    layerMatchesPurchasePrice(layer) ? 'bg-accent-light/40' : ''
                                                                }`}
                                                            >
                                                                <div>
                                                                    <p className="text-xs uppercase font-semibold text-muted">{t('BatchNumber', { index: idx + 1 })}</p>
                                                                    <p className="font-bold">
                                                                        {t('RemainingBatchQuantity', { remaining: layer.remaining_quantity, initial: layer.initial_quantity })}
                                                                    </p>
                                                                    <p className="text-xs text-muted">
                                                                        {new Date(layer.created_at).toLocaleDateString(i18n.language)}
                                                                    </p>
                                                                </div>
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                    <div>
                                                                        <label htmlFor={`inventory-layer-cost-${layer.id}`} className="block text-sm font-medium mb-2">{t('BatchPurchasePrice')}</label>
                                                                        <div className="relative">
                                                                            <input
                                                                                id={`inventory-layer-cost-${layer.id}`}
                                                                                 type="text"
                                                                                step="0.01"
                                                                                value={draft.unit_cost}
                                                                                onChange={(e) => setLayerDrafts({
                                                                                    ...layerDrafts,
                                                                                    [layer.id]: { ...draft, unit_cost: normalizeDecimalInput(e.target.value) },
                                                                                })}
                                                                            />
                                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">{currency.symbol}</span>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label htmlFor={`inventory-layer-note-${layer.id}`} className="block text-sm font-medium mb-2">{t('Notes')}</label>
                                                                        <input
                                                                            id={`inventory-layer-note-${layer.id}`}
                                                                            type="text"
                                                                            value={draft.note}
                                                                            onChange={(e) => setLayerDrafts({
                                                                                ...layerDrafts,
                                                                                [layer.id]: { ...draft, note: e.target.value },
                                                                            })}
                                                                            placeholder={t('InventoryCorrectionExample')}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => layerMutation.mutate({
                                                                        productId: viewingProduct.id,
                                                                        id: layer.id,
                                                                        index: idx,
                                                                        unit_cost: draft.unit_cost,
                                                                        note: draft.note,
                                                                    })}
                                                                    disabled={layerMutation.isPending}
                                                                    className="btn-secondary flex items-center gap-2 justify-center"
                                                                >
                                                                    <Save size={18} />
                                                                    {t('BatchNumber', { index: idx + 1 })}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="p-6 text-center text-muted">
                                                    {t('NoActiveBatch')}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex justify-end gap-3 pt-2">
                                        {canManageStock && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setViewingProduct(null);
                                                    openEditModal(viewingProduct);
                                                }}
                                                className="btn-secondary flex items-center gap-2"
                                            >
                                                <Edit size={18} />
                                                {t('EditFullProduct')}
                                            </button>
                                        )}
                                        <button type="button" onClick={() => setViewingProduct(null)} className="btn-primary">
                                            {t('Close')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Image View Modal */}
            {viewingImageProduct && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setViewingImageProduct(null)} />
                    <div
                        className="relative bg-secondary rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl animate-fadeScale"
                        role="dialog"
                        aria-modal="true"
                        aria-label={t('ProductImageLabel', { product: viewingImageProduct.name })}
                    >
                        <div className="relative aspect-square bg-gray-100">
                            <img
                                src={viewingImageProduct.image_url!}
                                className="w-full h-full object-contain"
                                alt={viewingImageProduct.name}
                            />
                            <button
                                onClick={() => setViewingImageProduct(null)}
                                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-md transition-colors"
                                aria-label={t('CloseImage')}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex items-center justify-between bg-secondary">
                            <div>
                                <h3 className="font-bold text-lg">{viewingImageProduct.name}</h3>
                                <p className="text-sm text-muted">{t('CurrentImagePreview')}</p>
                            </div>
                            <button
                                onClick={() => {
                                    handleListUploadClick(viewingImageProduct.id);
                                    setViewingImageProduct(null);
                                }}
                                className="btn-primary flex items-center gap-2"
                            >
                                <Edit size={18} />
                                <span>{t('ChangePhoto')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Hidden Input for List Upload */}
            <input
                ref={listFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleListFileChange}
            />

            {pendingImportFile && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        aria-label={t('Close')}
                        onClick={closeImportPreview}
                    />
                    <div
                        className="relative card w-full max-w-xl overflow-hidden animate-fadeScale"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="import-preview-title"
                    >
                        <div className="card-header flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <span className="w-10 h-10 rounded-xl bg-accent-light text-accent flex items-center justify-center shrink-0">
                                    <FileCheck2 size={21} />
                                </span>
                                <div>
                                    <h2 id="import-preview-title" className="text-lg font-bold">{t('ImportPreviewTitle')}</h2>
                                    <p className="text-sm text-muted break-all">{pendingImportFile.name}</p>
                                </div>
                            </div>
                            <button type="button" className="icon-button" aria-label={t('Close')} onClick={closeImportPreview}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="card-body space-y-4">
                            {previewImportMutation.isPending ? (
                                <div className="py-8 text-center text-muted" role="status">{t('ImportAnalyzing')}</div>
                            ) : importPreview ? (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {[
                                            [t('ImportValidRows'), importPreview.valid_rows, 'text-primary'],
                                            [t('ImportWouldCreate'), importPreview.would_create, 'text-success'],
                                            [t('ImportWouldUpdate'), importPreview.would_update, 'text-warning'],
                                            [t('ImportWouldSkip'), importPreview.would_skip, 'text-muted'],
                                        ].map(([label, value, tone]) => (
                                            <div key={String(label)} className="rounded-xl border border-border bg-tertiary p-3 text-center">
                                                <p className={`text-xl font-bold ${tone}`}>{value}</p>
                                                <p className="text-xs text-muted mt-1">{label}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <label className="flex items-start gap-3 rounded-xl border border-border p-4 cursor-pointer hover:bg-hover">
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={importUpsert}
                                            onChange={(event) => {
                                                const nextUpsert = event.target.checked;
                                                setImportUpsert(nextUpsert);
                                                previewImport(pendingImportFile, nextUpsert);
                                            }}
                                        />
                                        <span>
                                            <span className="block font-semibold">{t('ImportUpdateExisting')}</span>
                                            <span className="block text-sm text-muted mt-1">{t('ImportUpdateExistingHint')}</span>
                                        </span>
                                    </label>
                                    <div className="rounded-xl bg-warning-light text-warning p-3 text-sm flex items-start gap-2">
                                        <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                                        <span>{t('ImportConfirmationWarning')}</span>
                                    </div>
                                    {importPreview.errors.length > 0 && (
                                        <div className="rounded-xl bg-danger-light text-danger p-3 text-sm">
                                            {importPreview.errors.join(' · ')}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="py-8 text-center text-danger" role="alert">{t('ImportPreviewUnavailable')}</div>
                            )}
                        </div>
                        <div className="card-footer flex justify-end gap-3">
                            <button type="button" className="btn-secondary" onClick={closeImportPreview} disabled={importMutation.isPending}>
                                {t('Cancel')}
                            </button>
                            <button
                                type="button"
                                className="btn-primary"
                                disabled={!importPreview || previewImportMutation.isPending || importMutation.isPending}
                                onClick={() => importMutation.mutate({ file: pendingImportFile, upsert: importUpsert })}
                            >
                                {importMutation.isPending ? t('Loading') : t('ImportConfirmAction')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={Boolean(productToDeactivate)}
                title={t('DisableProductTitle')}
                description={productToDeactivate
                    ? t('DisableProductDescription', { name: productToDeactivate.name })
                    : ''}
                confirmLabel={t('Disable')}
                busy={deleteMutation.isPending}
                onCancel={() => setProductToDeactivate(null)}
                onConfirm={() => {
                    if (productToDeactivate) deleteMutation.mutate(productToDeactivate.id);
                }}
            />
        </div>
    );
}
