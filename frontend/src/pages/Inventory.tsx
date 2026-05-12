import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage, getApiErrorStatus } from '../api/client';
import { useToast } from '../components/ToastContext';
import { useTranslation } from 'react-i18next';
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
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';

interface Product {
    id: number;
    name: string;
    barcode: string;
    description: string;
    purchase_price: number;
    sale_price_ht: number;
    price_ttc: number;
    stock: number;
    min_stock: number;
    category: number | null;
    category_name: string | null;
    supplier: number | null;
    supplier_name: string | null;
    profit_margin: number;
    is_low_stock: boolean;
    image_url: string | null;
    cost_layers?: StockLayer[];
}

interface StockLayer {
    id: number;
    initial_quantity: number;
    remaining_quantity: number;
    unit_cost: string | number;
    sale_price: string | number;
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

export default function Inventory() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [purchasePriceFilter, setPurchasePriceFilter] = useState('');
    const [stockFilter, setStockFilter] = useState<StockFilter>('all');
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
    const [priceDraft, setPriceDraft] = useState({ purchase_price: '', sale_price_ht: '' });
    const [layerDrafts, setLayerDrafts] = useState<Record<number, { unit_cost: string; sale_price: string; note: string }>>({});
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

    const { data: productsData, isLoading, error } = useQuery<{ results?: Product[]; count?: number; next?: string | null; previous?: string | null } | Product[]>({
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
    const setPurchasePriceFilterReset = (s: string) => { setPurchasePriceFilter(s); setPage(1); };

    const { data: categoriesData } = useQuery({
        queryKey: ['categories'],
        queryFn: () => client.get('/inventory/categories/').then(res => res.data)
    });

    const categories: Category[] = categoriesData?.results || categoriesData || [];

    const { data: suppliersData } = useQuery({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => res.data)
    });

    const suppliers: Supplier[] = suppliersData?.results || suppliersData || [];

    const buildFormData = (data: typeof formData, image: File | null) => {
        const payload = new FormData();
        payload.append('name', data.name);
        payload.append('barcode', data.barcode);
        payload.append('description', data.description);
        payload.append('purchase_price', data.purchase_price || '0');
        payload.append('sale_price_ht', data.sale_price_ht);
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
            toast.error('Erreur lors de la creation : ' + getApiErrorMessage(error));
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
            console.error("Update Error:", error);
            const detail = getApiErrorMessage(error);
            toast.error(`Erreur lors de la modification : ${detail}`);
        }
    });

    const priceMutation = useMutation({
        mutationFn: (data: { id: number; purchase_price: string; sale_price_ht: string }) =>
            client.patch(`/inventory/products/${data.id}/`, {
                purchase_price: data.purchase_price || '0',
                sale_price_ht: data.sale_price_ht || '0',
            }),
        onSuccess: (response) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setViewingProduct(response.data);
            openProductDetails(response.data);
            toast.success('Prix du produit mis a jour');
        },
        onError: (error: unknown) => {
            toast.error('Erreur prix produit : ' + getApiErrorMessage(error));
        }
    });

    const normalizeMoney = (value: string) => value.trim().replace(',', '.');

    const layerMutation = useMutation({
        mutationFn: async (data: { productId: number; id?: number; index: number; unit_cost: string; sale_price: string; note: string }) => {
            const url = data.id
                ? `/inventory/products/${data.productId}/cost-layers/${data.id}/`
                : `/inventory/products/${data.productId}/cost-layers/by-position/${data.index}/`;
            const payload = {
                layer_id: data.id,
                index: data.index,
                unit_cost: normalizeMoney(data.unit_cost) || '0',
                sale_price: normalizeMoney(data.sale_price) || null,
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
        onSuccess: (_response, variables) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setViewingProduct(prev => {
                if (!prev?.cost_layers) return prev;
                return {
                    ...prev,
                    cost_layers: prev.cost_layers.map((layer, index) =>
                        (variables.id ? layer.id === variables.id : index === variables.index)
                            ? { ...layer, unit_cost: normalizeMoney(variables.unit_cost), sale_price: normalizeMoney(variables.sale_price), note: variables.note }
                            : layer
                    ),
                };
            });
            toast.success('Lot FIFO mis a jour');
        },
        onError: (error: unknown) => {
            toast.error('Erreur lot FIFO : ' + getApiErrorMessage(error, 'Verifie que PythonAnywhere est bien a jour puis recharge la page.'));
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => client.delete(`/inventory/products/${id}/`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] })
    });

    const importExcelFileRef = useRef<HTMLInputElement | null>(null);

    const importMutation = useMutation({
        mutationFn: (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            return client.post('/inventory/products/import_excel/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        },
        onSuccess: (data: { data: { created: number; updated?: number; images?: number; skipped?: number; errors: unknown[] } }) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            toast.success(`Import termine ! ${data.data.created} produits crees, ${data.data.images || 0} photo(s) importee(s), ${data.data.updated || 0} produit(s) existant(s) complete(s), ${data.data.skipped || 0} ignore(s). ${data.data.errors.length} erreur(s).`);
        },
        onError: (error: unknown) => {
            console.error("Import Error Details:", error);
            const detail = getApiErrorMessage(error);
            const responseStatus = getApiErrorStatus(error);
            const status = responseStatus ? ` (Status: ${responseStatus})` : '';
            toast.error(`Erreur import${status} : ${detail}`);
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
        const drafts: Record<number, { unit_cost: string; sale_price: string; note: string }> = {};
        product.cost_layers?.forEach((layer) => {
            drafts[layer.id] = {
                unit_cost: Number(layer.unit_cost).toString(),
                sale_price: Number(layer.sale_price).toString(),
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
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">{t('Inventory')}</h1>
                {canManageStock && (
                    <div className="flex gap-2">
                        <input
                            type="file"
                            accept=".xlsx,.xls,.csv,.zip,application/zip"
                            className="hidden"
                            ref={importExcelFileRef}
                            onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                    importMutation.mutate(e.target.files[0]);
                                    e.target.value = ''; // Reset input
                                }
                            }}
                        />
                        <button
                            onClick={() => importExcelFileRef.current?.click()}
                            className="btn-secondary flex items-center gap-2"
                            disabled={importMutation.isPending}
                        >
                            <Upload size={20} />
                            <span>{importMutation.isPending ? t('Loading') : 'Importer CSV/ZIP'}</span>
                        </button>

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
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                    <input
                        type="text"
                        placeholder={t('SearchProducts')}
                        style={{ paddingLeft: '3rem' }}
                        value={search}
                        onChange={(e) => setSearchReset(e.target.value)}
                    />
                </div>
                {isAdmin && (
                    <div className="relative w-full sm:w-52">
                        <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                        <input
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="Prix achat"
                            className="pr-10"
                            style={{ paddingLeft: '2.75rem' }}
                            value={purchasePriceFilter}
                            onChange={(e) => setPurchasePriceFilterReset(e.target.value)}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">DH</span>
                    </div>
                )}
                <div className="flex bg-tertiary rounded-lg p-1">
                    <button
                        type="button"
                        onClick={() => setStockFilterReset('all')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${stockFilter === 'all' ? 'bg-secondary shadow text-accent' : 'text-muted hover:text-primary'}`}
                    >
                        Tous
                    </button>
                    <button
                        type="button"
                        onClick={() => setStockFilterReset('low')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${stockFilter === 'low' ? 'bg-warning text-white shadow' : 'text-muted hover:text-primary'}`}
                    >
                        <AlertTriangle size={14} /> Stock bas
                    </button>
                    <button
                        type="button"
                        onClick={() => setStockFilterReset('out')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-1 ${stockFilter === 'out' ? 'bg-danger text-white shadow' : 'text-muted hover:text-primary'}`}
                    >
                        <X size={14} /> Rupture
                    </button>
                </div>
                <span className="text-sm text-muted ml-auto">
                    {totalCount} produit{totalCount > 1 ? 's' : ''}
                </span>
            </div>

            {/* Products Table */}
            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="p-8 text-center">
                            <div className="animate-spin inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full mb-4"></div>
                            <p className="text-muted">{t('Loading')}</p>
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center text-danger">
                            <AlertTriangle size={48} className="mx-auto mb-4" />
                            <p className="font-bold">Erreur de chargement</p>
                            <p className="text-sm text-muted mt-2">Vérifiez votre connexion et réessayez</p>
                        </div>
                    ) : products.length === 0 ? (
                        <div className="p-8 text-center">
                            <Package size={48} className="mx-auto mb-4 text-muted" />
                            <p className="font-bold">{t('NoProducts')}</p>
                            <p className="text-sm text-muted mt-2">Cliquez sur "Ajouter un produit" pour commencer</p>
                        </div>
                    ) : (
                        <table>
                            <thead>
                                <tr>
                                    <th>Produit</th>
                                    <th>Code-barres</th>
                                    <th>Catégorie</th>
                                    {isAdmin && <th className="text-right">Prix Achat</th>}
                                    <th className="text-right">Prix Vente</th>
                                    {isAdmin && <th className="text-right">Marge</th>}
                                    <th className="text-center">Stock</th>
                                    <th className="text-center">Seuil</th>
                                    <th>Fournisseur</th>
                                    {canManageStock && <th>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {products.map((product) => (
                                    <tr key={product.id}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div
                                                    onClick={() => {
                                                        if (product.image_url) {
                                                            setViewingImageProduct(product);
                                                        } else {
                                                            handleListUploadClick(product.id);
                                                        }
                                                    }}
                                                    className="w-10 h-10 bg-tertiary rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-accent transition-all relative group"
                                                    title={product.image_url ? "Voir la photo" : "Ajouter une photo"}
                                                >
                                                    {product.image_url ? (
                                                        <>
                                                            <img
                                                                src={product.image_url}
                                                                alt={`Photo de ${product.name}`}
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
                                                </div>
                                                <div>
                                                    <button
                                                        type="button"
                                                        onClick={() => openProductDetails(product)}
                                                        className="font-medium text-left hover:text-accent transition-colors"
                                                        title="Ouvrir la fiche produit"
                                                    >
                                                        {product.name}
                                                    </button>
                                                    {isAdmin && product.cost_layers && product.cost_layers.length > 0 && (
                                                        <div className="mt-2 space-y-1">
                                                            <p className="text-[10px] uppercase font-semibold text-muted">Lots FIFO</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {product.cost_layers.slice(0, 3).map((layer, idx) => (
                                                                    <span
                                                                        key={`${product.id}-layer-${idx}`}
                                                                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] border ${
                                                                            layerMatchesPurchasePrice(layer)
                                                                                ? 'bg-accent-light text-accent border-accent/40'
                                                                                : 'bg-tertiary text-muted border-border'
                                                                        }`}
                                                                        title={layer.note || `Lot du ${new Date(layer.created_at).toLocaleDateString('fr-FR')}`}
                                                                    >
                                                                        <strong className="text-primary">Lot {idx + 1}</strong>
                                                                        Achat {Number(layer.unit_cost).toFixed(2)}
                                                                        <span>→</span>
                                                                        Vente {Number(layer.sale_price).toFixed(2)}
                                                                        <span className="text-accent font-semibold">
                                                                            {layer.remaining_quantity}/{layer.initial_quantity}
                                                                        </span>
                                                                    </span>
                                                                ))}
                                                                {product.cost_layers.length > 3 && (
                                                                    <span className="text-[11px] text-muted px-2 py-1">
                                                                        +{product.cost_layers.length - 3} lot(s)
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
                                        {isAdmin && <td className="text-right">{product.purchase_price?.toFixed(2)} DH</td>}
                                        <td className="text-right font-semibold">{product.price_ttc?.toFixed(2)} DH</td>
                                        {isAdmin && (
                                            <td className="text-right">
                                                <span className={product.profit_margin > 0 ? 'text-success' : 'text-danger'}>
                                                    {product.profit_margin?.toFixed(2)} DH
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
                                                        title="Ouvrir la fiche prix & lots"
                                                    >
                                                        <Edit size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (confirm('Supprimer ce produit?')) {
                                                                deleteMutation.mutate(product.id);
                                                            }
                                                        }}
                                                        className="btn-ghost p-2 text-danger hover:bg-danger-light"
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
                            Affichage {pageStart}–{pageEnd} sur {totalCount}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={!hasPrev || page === 1}
                                className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                aria-label="Page précédente"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className="text-sm font-medium">Page {page}</span>
                            <button
                                type="button"
                                onClick={() => setPage(p => p + 1)}
                                disabled={!hasNext}
                                className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                aria-label="Page suivante"
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
                    <div className="relative card w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-slideUp p-0">
                        {/* Header */}
                        <div className="p-6 border-b flex items-center justify-between bg-secondary sticky top-0 z-10">
                            <h2 className="text-xl font-bold">
                                {editingProduct ? 'Modifier le produit' : 'Nouveau produit'}
                            </h2>
                            <button onClick={closeModal} className="btn-ghost p-2 -mr-2">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-8">

                            {/* Top Section: Image & Basic Info */}
                            <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-8">
                                {/* Image Upload Column - Reduced Size */}
                                <div className="w-full flex flex-col items-center">
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-full max-w-[220px] aspect-square bg-tertiary rounded-2xl border-2 border-dashed border-border hover:border-accent hover:bg-accent-light/10 transition-colors flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group shrink-0"
                                    >
                                        {imagePreview ? (
                                            <>
                                                <img src={imagePreview} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-white font-medium flex items-center gap-2">
                                                        <Edit size={20} />
                                                        Modifier
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-center text-muted p-4">
                                                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                                                    <ImageIcon size={32} />
                                                </div>
                                                <p className="font-medium">Ajouter une photo</p>
                                                <p className="text-xs mt-1">Cliquez pour uploader</p>
                                            </div>
                                        )}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleImageChange}
                                        />
                                    </div>
                                    <p className="text-xs text-muted text-center mt-2">
                                        JPG, PNG ou WEBP max 5Mo
                                    </p>
                                </div>

                                {/* Basic Info Column */}
                                <div className="flex-1 space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold mb-2">Nom du produit *</label>
                                        <input
                                            type="text"
                                            className="input-lg text-lg font-bold"
                                            placeholder="Ex: Stylo Plume Parker"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Code-barres *</label>
                                            <div className="relative">
                                                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                                <input
                                                    type="text"
                                                    className="pl-12 font-mono"
                                                    value={formData.barcode}
                                                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                                    required
                                                    disabled={!!editingProduct}
                                                    placeholder="Scan..."
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Catégorie</label>
                                            <select
                                                value={formData.category}
                                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                className="w-full p-2.5 bg-secondary border border-border rounded-lg"
                                            >
                                                <option value="">-- Non classé --</option>
                                                {categories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-2">Description</label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={4}
                                            className="w-full resize-none"
                                            placeholder="Détails du produit..."
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
                                        Logistique & Fournisseur
                                    </h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold mb-2">Fournisseur</label>
                                            <select
                                                value={formData.supplier}
                                                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                                className="w-full p-3 bg-secondary border-2 border-accent/20 rounded-xl focus:border-accent focus:ring-accent"
                                            >
                                                <option value="">Sélectionner un fournisseur...</option>
                                                {suppliers.map(sup => (
                                                    <option key={sup.id} value={sup.id}>{sup.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Stock Actuel</label>
                                                <input
                                                    type="number"
                                                    value={formData.stock}
                                                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                                    className="font-bold"
                                                    disabled={!!editingProduct}
                                                />
                                                {editingProduct && (
                                                    <p className="text-[10px] text-muted mt-1">
                                                        Le stock se corrige via Inventaire, commandes ou caisse pour garder les lots FIFO propres.
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-2 text-danger flex items-center gap-1">
                                                    <AlertCircle size={14} />
                                                    Stock Critique
                                                </label>
                                                <input
                                                    type="number"
                                                    value={formData.min_stock}
                                                    onChange={(e) => setFormData({ ...formData, min_stock: e.target.value })}
                                                    className="border-danger/30 focus:border-danger focus:ring-danger bg-danger-light/10"
                                                />
                                                <p className="text-[10px] text-danger mt-1">Seuil d'alerte stock bas</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-tertiary/30 p-6 rounded-2xl border border-tertiary">
                                    <h3 className="flex items-center gap-2 font-bold text-primary mb-4">
                                        <Banknote size={20} />
                                        Prix & Marges
                                    </h3>

                                    <div className="space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            {isAdmin && (
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">Prix Achat</label>
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={formData.purchase_price}
                                                            onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">DH</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-bold mb-2">Prix de Vente *</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="text-lg font-bold border-accent"
                                                    value={formData.sale_price_ht}
                                                    onChange={(e) => setFormData({ ...formData, sale_price_ht: e.target.value })}
                                                    required
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted font-bold">DH</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-6 border-t bg-secondary sticky bottom-0 -mx-6 px-6 pb-2">
                                <button type="button" onClick={closeModal} className="btn-secondary px-6">
                                    Annuler
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex items-center gap-2 px-8 text-lg"
                                    disabled={createMutation.isPending || updateMutation.isPending}
                                >
                                    <Save size={20} />
                                    <span>{editingProduct ? 'Enregistrer les modifications' : 'Créer le produit'}</span>
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
                    <div className="relative card w-full max-w-6xl max-h-[92vh] overflow-hidden animate-slideUp p-0">
                        <div className="p-5 border-b flex items-center justify-between bg-secondary">
                            <div>
                                <h2 className="text-xl font-bold">{viewingProduct.name}</h2>
                                <p className="text-sm text-muted font-mono">{viewingProduct.barcode}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openAdjacentProduct(-1)}
                                    disabled={products.findIndex(product => product.id === viewingProduct.id) <= 0}
                                    className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                    aria-label="Produit precedent"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => openAdjacentProduct(1)}
                                    disabled={products.findIndex(product => product.id === viewingProduct.id) === -1 || products.findIndex(product => product.id === viewingProduct.id) >= products.length - 1}
                                    className="btn-ghost btn-icon disabled:opacity-30 disabled:cursor-not-allowed"
                                    aria-label="Produit suivant"
                                >
                                    <ChevronRight size={20} />
                                </button>
                                <button onClick={() => setViewingProduct(null)} className="btn-ghost p-2">
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
                                                <p className="font-medium">Aucune photo</p>
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
                                            Changer la photo
                                        </button>
                                    )}
                                </div>

                                <div className="p-6 space-y-6">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">Stock</p>
                                            <p className="text-2xl font-bold">{viewingProduct.stock}</p>
                                        </div>
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">Seuil</p>
                                            <p className="text-2xl font-bold">{viewingProduct.min_stock}</p>
                                        </div>
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">Categorie</p>
                                            <p className="font-bold truncate">{viewingProduct.category_name || '-'}</p>
                                        </div>
                                        <div className="rounded-xl border border-border p-4 bg-secondary">
                                            <p className="text-xs uppercase font-semibold text-muted">Fournisseur</p>
                                            <p className="font-bold truncate">{viewingProduct.supplier_name || '-'}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                        {isAdmin && (
                                            <div className="rounded-2xl border border-border p-5 bg-secondary">
                                                <h3 className="flex items-center gap-2 font-bold mb-4">
                                                    <Banknote size={20} />
                                                    Prix par defaut du produit
                                                </h3>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium mb-2">Prix achat</label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={priceDraft.purchase_price}
                                                                onChange={(e) => setPriceDraft({ ...priceDraft, purchase_price: e.target.value })}
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">DH</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium mb-2">Prix vente</label>
                                                        <div className="relative">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={priceDraft.sale_price_ht}
                                                                onChange={(e) => setPriceDraft({ ...priceDraft, sale_price_ht: e.target.value })}
                                                            />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">DH</span>
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
                                                    Enregistrer les prix du produit
                                                </button>
                                            </div>
                                        )}

                                        <div className="rounded-2xl border border-border p-5 bg-secondary">
                                            <h3 className="font-bold mb-4">Informations</h3>
                                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                <div>
                                                    <dt className="text-muted">Prix achat affiche</dt>
                                                    <dd className="font-bold">{Number(viewingProduct.purchase_price || 0).toFixed(2)} DH</dd>
                                                </div>
                                                <div>
                                                    <dt className="text-muted">Prix vente affiche</dt>
                                                    <dd className="font-bold">{Number(viewingProduct.price_ttc || 0).toFixed(2)} DH</dd>
                                                </div>
                                                {isAdmin && (
                                                    <div>
                                                        <dt className="text-muted">Marge par defaut</dt>
                                                        <dd className={viewingProduct.profit_margin > 0 ? 'font-bold text-success' : 'font-bold text-danger'}>
                                                            {Number(viewingProduct.profit_margin || 0).toFixed(2)} DH
                                                        </dd>
                                                    </div>
                                                )}
                                                <div>
                                                    <dt className="text-muted">Statut</dt>
                                                    <dd className="font-bold">{viewingProduct.is_low_stock ? 'Stock bas' : 'Stock OK'}</dd>
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
                                                <h3 className="font-bold">Lots FIFO actifs</h3>
                                                <p className="text-sm text-muted">
                                                    Chaque lot garde son propre prix d'achat et prix de vente. La quantite est en lecture seule pour proteger le stock.
                                                </p>
                                            </div>
                                            {viewingProduct.cost_layers && viewingProduct.cost_layers.length > 0 ? (
                                                <div className="divide-y divide-border">
                                                    {viewingProduct.cost_layers.map((layer, idx) => {
                                                        const draft = layerDrafts[layer.id] || {
                                                            unit_cost: Number(layer.unit_cost).toString(),
                                                            sale_price: Number(layer.sale_price).toString(),
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
                                                                    <p className="text-xs uppercase font-semibold text-muted">Lot {idx + 1}</p>
                                                                    <p className="font-bold">
                                                                        {layer.remaining_quantity}/{layer.initial_quantity} restant
                                                                    </p>
                                                                    <p className="text-xs text-muted">
                                                                        {new Date(layer.created_at).toLocaleDateString('fr-FR')}
                                                                    </p>
                                                                </div>
                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-2">Prix achat lot</label>
                                                                        <div className="relative">
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                value={draft.unit_cost}
                                                                                onChange={(e) => setLayerDrafts({
                                                                                    ...layerDrafts,
                                                                                    [layer.id]: { ...draft, unit_cost: e.target.value },
                                                                                })}
                                                                            />
                                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">DH</span>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-2">Prix vente lot</label>
                                                                        <div className="relative">
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                value={draft.sale_price}
                                                                                onChange={(e) => setLayerDrafts({
                                                                                    ...layerDrafts,
                                                                                    [layer.id]: { ...draft, sale_price: e.target.value },
                                                                                })}
                                                                            />
                                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm">DH</span>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium mb-2">Note</label>
                                                                        <input
                                                                            type="text"
                                                                            value={draft.note}
                                                                            onChange={(e) => setLayerDrafts({
                                                                                ...layerDrafts,
                                                                                [layer.id]: { ...draft, note: e.target.value },
                                                                            })}
                                                                            placeholder="Ex: corrige inventaire"
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
                                                                        sale_price: draft.sale_price,
                                                                        note: draft.note,
                                                                    })}
                                                                    disabled={layerMutation.isPending}
                                                                    className="btn-secondary flex items-center gap-2 justify-center"
                                                                >
                                                                    <Save size={18} />
                                                                    Lot
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="p-6 text-center text-muted">
                                                    Aucun lot actif pour ce produit.
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
                                                Modifier toute la fiche
                                            </button>
                                        )}
                                        <button type="button" onClick={() => setViewingProduct(null)} className="btn-primary">
                                            Fermer
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
                    <div className="relative bg-secondary rounded-2xl overflow-hidden max-w-lg w-full shadow-2xl animate-fadeScale">
                        <div className="relative aspect-square bg-gray-100">
                            <img
                                src={viewingImageProduct.image_url!}
                                className="w-full h-full object-contain"
                                alt={viewingImageProduct.name}
                            />
                            <button
                                onClick={() => setViewingImageProduct(null)}
                                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-md transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 flex items-center justify-between bg-secondary">
                            <div>
                                <h3 className="font-bold text-lg">{viewingImageProduct.name}</h3>
                                <p className="text-sm text-muted">Aperçu de l'image actuelle</p>
                            </div>
                            <button
                                onClick={() => {
                                    handleListUploadClick(viewingImageProduct.id);
                                    setViewingImageProduct(null);
                                }}
                                className="btn-primary flex items-center gap-2"
                            >
                                <Edit size={18} />
                                <span>Changer la photo</span>
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
        </div>
    );
}
