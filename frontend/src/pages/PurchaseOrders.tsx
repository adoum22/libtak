import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import ProductCreateModal from '../components/ProductCreateModal';
import {
    ClipboardList,
    Plus,
    Send,
    Package,
    Check,
    X,
    ChevronDown,
    ChevronUp,
    Trash2,
    Calendar,
    Search,
    Barcode,
    AlertTriangle
} from 'lucide-react';

interface Supplier {
    id: number;
    name: string;
}

interface Product {
    id: number;
    name: string;
    barcode: string;
    purchase_price: number;
    sale_price_ht?: number;
    price_ttc?: number;
    stock: number;
    cost_layers?: StockLayer[];
}

interface StockLayer {
    initial_quantity: number;
    remaining_quantity: number;
    unit_cost: number;
    sale_price: number;
    created_at: string;
    note?: string;
}

type PurchaseOrderForm = {
    supplier: number;
    notes: string;
    expected_date: string | null;
    items: Array<{ product: number; quantity: number; unit_cost: number; sale_price?: number }>;
};

type ReceiveOrderItem = {
    item_id: number;
    quantity: number;
    unit_cost?: number;
    update_purchase_price?: boolean;
    new_sale_price?: number;
};

// État local de la modal de réception : un draft par ligne de commande.
// Permet de saisir la quantité réellement reçue, le prix payé (peut différer
// du prix négocié à la commande), et de propager ce nouveau prix sur la
// fiche produit (purchase_price par défaut + sale_price_ht public).
type ReceiveDraft = {
    item_id: number;
    product_name: string;
    barcode?: string;
    ordered_qty: number;
    already_received: number;
    remaining: number;
    quantity: string;          // ce qu'on reçoit MAINTENANT
    unit_cost: string;         // prix réel appliqué (par défaut = prix de la commande)
    update_purchase_price: boolean;
    new_sale_price: string;    // optionnel
    current_sale_price: number;
};

type CreatedProduct = {
    id: number;
    name: string;
    barcode: string;
    purchase_price: string | number;
};

interface PurchaseOrderItem {
    id: number;
    product: number;
    product_name?: string;
    quantity: number;
    unit_cost: number;
    sale_price?: number | null;
    current_sale_price?: number | null;
    received_quantity: number;
    barcode?: string;
    product_layers?: StockLayer[];
}

interface PurchaseOrder {
    id: number;
    reference: string;
    supplier: number;
    supplier_name?: string;
    status: string;
    status_display: string;
    notes: string;
    expected_date: string | null;
    total_amount: number;
    items_count: number;
    items: PurchaseOrderItem[];
    created_at: string;
}

const asArray = <T,>(value: unknown): T[] => {
    if (Array.isArray(value)) return value as T[];
    if (
        value &&
        typeof value === 'object' &&
        'results' in value &&
        Array.isArray((value as { results?: unknown }).results)
    ) {
        return (value as { results: T[] }).results;
    }
    return [];
};

const normalizeOrder = (order: PurchaseOrder): PurchaseOrder => ({
    ...order,
    items: asArray<PurchaseOrderItem>(order.items),
});

export default function PurchaseOrders() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [showForm, setShowForm] = useState(false);
    const [showCreateProduct, setShowCreateProduct] = useState(false);
    const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
    const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
    const [receiveDrafts, setReceiveDrafts] = useState<ReceiveDraft[]>([]);
    const [formData, setFormData] = useState({
        supplier: '',
        notes: '',
        expected_date: '',
        items: [] as {
            product: number;
            quantity: number;
            unit_cost: number;
            sale_price: number;
            productName?: string;
            barcode?: string;
        }[]
    });
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [itemQty, setItemQty] = useState(1);
    const [searchProduct, setSearchProduct] = useState('');

    // Fetch orders
    const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
        queryKey: ['purchaseOrders'],
        queryFn: () => client
            .get('/inventory/purchase-orders/')
            .then(res => asArray<PurchaseOrder>(res.data).map(normalizeOrder))
    });

    // Fetch suppliers
    const { data: suppliers = [] } = useQuery<Supplier[]>({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => asArray<Supplier>(res.data))
    });

    // Search products
    const { data: products = [] } = useQuery<Product[]>({
        queryKey: ['products', searchProduct],
        queryFn: () => client
            .get(`/inventory/products/?search=${searchProduct}`)
            .then(res => asArray<Product>(res.data)),
        enabled: searchProduct.length > 1
    });

    // Create order
    const createOrder = useMutation({
        mutationFn: (data: PurchaseOrderForm) => client.post('/inventory/purchase-orders/', data),
        onSuccess: () => {
            toast.success('Commande créée');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            resetForm();
        },
        onError: (err: unknown) => {
            console.error("Create Order Error:", err);
            toast.error(getApiErrorMessage(err, 'Erreur lors de la creation'));
        }
    });

    // Send order
    const sendOrder = useMutation({
        mutationFn: (id: number) => client.post(`/inventory/purchase-orders/${id}/send/`),
        onSuccess: () => {
            toast.success('Commande envoyée');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
        }
    });

    // Receive order
    const receiveOrder = useMutation({
        mutationFn: ({ id, items }: { id: number, items: ReceiveOrderItem[] }) =>
            client.post(`/inventory/purchase-orders/${id}/receive/`, { items }),
        onSuccess: () => {
            toast.success('Réception validée - Stock mis à jour');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
        },
        onError: (err: unknown) => {
            toast.error('Erreur lors de la réception');
            console.error(err);
        }
    });

    // Cancel order
    const cancelOrder = useMutation({
        mutationFn: (id: number) => client.post(`/inventory/purchase-orders/${id}/cancel/`),
        onSuccess: () => {
            toast.success('Commande annulée');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
        }
    });

    const resetForm = () => {
        setFormData({ supplier: '', notes: '', expected_date: '', items: [] });
        setShowForm(false);
        setSelectedProduct(null);
        setSearchProduct('');
    };

    const addItem = () => {
        if (!selectedProduct) return;
        const existing = formData.items.find(i => i.product === selectedProduct.id);
        if (existing) {
            setFormData({
                ...formData,
                items: formData.items.map(i =>
                    i.product === selectedProduct.id
                        ? { ...i, quantity: i.quantity + itemQty }
                        : i
                )
            });
        } else {
            setFormData({
                ...formData,
                items: [...formData.items, {
                    product: selectedProduct.id,
                    quantity: itemQty,
                    unit_cost: selectedProduct.purchase_price,
                    sale_price: Number(selectedProduct.price_ttc ?? selectedProduct.sale_price_ht) || 0,
                    productName: selectedProduct.name,
                    barcode: selectedProduct.barcode
                }]
            });
        }
        setSelectedProduct(null);
        setSearchProduct('');
        setItemQty(1);
    };

    const removeItem = (productId: number) => {
        setFormData({
            ...formData,
            items: formData.items.filter(i => i.product !== productId)
        });
    };

    const handleSubmit = () => {
        if (!formData.supplier) {
            toast.error('Veuillez sélectionner un fournisseur');
            return;
        }
        if (formData.items.length === 0) {
            toast.error('Veuillez ajouter au moins un produit');
            return;
        }

        const payload = {
            supplier: parseInt(formData.supplier),
            notes: formData.notes,
            expected_date: formData.expected_date || null,
            items: formData.items.map(({ product, quantity, unit_cost, sale_price }) => ({
                product,
                quantity,
                unit_cost,
                sale_price,
            }))
        };

        createOrder.mutate(payload);
    };

    const handleReceiveClick = (order: PurchaseOrder) => {
        // Construit le draft initial : 1 ligne par article, pré-rempli avec
        // la quantité restante et le prix de la commande comme défauts.
        const orderItems = asArray<PurchaseOrderItem>(order.items);
        const drafts: ReceiveDraft[] = orderItems
            .filter(item => (item.quantity - (item.received_quantity || 0)) > 0)
            .map(item => {
                const remaining = Math.max(0, item.quantity - (item.received_quantity || 0));
                // On essaie de récupérer le prix de vente actuel via la fiche produit
                // si disponible (le serializer Product le renvoie en `sale_price_ht`)
                const currentSale = Number(item.current_sale_price ?? item.sale_price ?? 0);
                return {
                    item_id: item.id,
                    product_name: item.product_name || `Produit #${item.product}`,
                    barcode: item.barcode,
                    ordered_qty: item.quantity,
                    already_received: item.received_quantity || 0,
                    remaining,
                    quantity: String(remaining),
                    unit_cost: String(item.unit_cost),
                    update_purchase_price: false,
                    new_sale_price: item.sale_price ? String(item.sale_price) : '',
                    current_sale_price: Number(currentSale) || 0,
                };
            });

        if (drafts.length === 0) {
            toast.info('Tous les articles de cette commande ont déjà été reçus.');
            return;
        }

        setReceiveDrafts(drafts);
        setReceivingOrder(order);
    };

    const updateDraft = (item_id: number, patch: Partial<ReceiveDraft>) => {
        setReceiveDrafts(drafts =>
            drafts.map(d => (d.item_id === item_id ? { ...d, ...patch } : d))
        );
    };

    const handleReceiveConfirm = () => {
        if (!receivingOrder) return;

        const items: ReceiveOrderItem[] = receiveDrafts
            .map(d => {
                const qty = Number(d.quantity) || 0;
                const cost = Number(d.unit_cost);
                const newSale = Number(d.new_sale_price);
                if (qty <= 0) return null;
                const payload: ReceiveOrderItem = {
                    item_id: d.item_id,
                    quantity: qty,
                };
                // unit_cost envoyé seulement si différent du prix d'origine
                // OU si l'utilisateur veut le propager comme nouveau défaut
                if (Number.isFinite(cost) && cost > 0) payload.unit_cost = cost;
                if (d.update_purchase_price) payload.update_purchase_price = true;
                if (Number.isFinite(newSale) && newSale > 0) payload.new_sale_price = newSale;
                return payload;
            })
            .filter((item): item is ReceiveOrderItem => item !== null);

        if (items.length === 0) {
            toast.error('Aucune quantité à réceptionner.');
            return;
        }

        receiveOrder.mutate(
            { id: receivingOrder.id, items },
            {
                onSuccess: () => {
                    setReceivingOrder(null);
                    setReceiveDrafts([]);
                },
            }
        );
    };

    const handleReceiveCancel = () => {
        setReceivingOrder(null);
        setReceiveDrafts([]);
    };

    const handleProductCreated = (newProduct: CreatedProduct) => {
        // Automatically add the created product to the list
        setFormData({
            ...formData,
            items: [...formData.items, {
                product: newProduct.id,
                quantity: 1,
                unit_cost: Number(newProduct.purchase_price) || 0,
                sale_price: 0,
                productName: newProduct.name,
                barcode: newProduct.barcode
            }]
        });
        setSearchProduct('');
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            DRAFT: 'badge-secondary',
            SENT: 'badge-info',
            PARTIAL: 'badge-warning',
            RECEIVED: 'badge-success',
            CANCELLED: 'badge-danger'
        };
        return styles[status] || 'badge-secondary';
    };

    const orderTotal = formData.items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <ClipboardList className="text-accent" />
                        Commandes Fournisseurs
                    </h1>
                    <p className="text-muted mt-1">Gérez vos commandes d'approvisionnement</p>
                </div>
                <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
                    <Plus size={18} />
                    Nouvelle Commande
                </button>
            </div>

            {/* Create Order Form */}
            {showForm && (
                <div className="card p-6 border-accent border-2">
                    <h2 className="text-xl font-bold mb-4">Nouvelle Commande</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Fournisseur *</label>
                            <select
                                value={formData.supplier}
                                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                className="input w-full"
                            >
                                <option value="">Sélectionner...</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Date prévue</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                <input
                                    type="date"
                                    value={formData.expected_date}
                                    onChange={(e) => setFormData({ ...formData, expected_date: e.target.value })}
                                    className="input w-full pl-10"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Add Product Section */}
                    <div className="mb-4 bg-tertiary/30 p-4 rounded-lg">
                        <label className="block text-sm font-medium mb-2">Ajouter des articles</label>
                        <div className="flex flex-wrap gap-2 items-start">
                            <div className="flex-1 min-w-[250px] relative z-50">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                    <input
                                        type="text"
                                        placeholder="Nom ou Code-barres..."
                                        className="input w-full pl-10"
                                        value={searchProduct}
                                        onChange={(e) => setSearchProduct(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && products.length > 0) {
                                                setSelectedProduct(products[0]);
                                                setSearchProduct(products[0].name);
                                            }
                                        }}
                                    />
                                </div>

                                {/* Product Suggestions Dropdown */}
                                {products.length > 0 && searchProduct && !selectedProduct && (
                                    <div className="absolute top-full left-0 right-0 bg-secondary border rounded-lg shadow-xl z-[100] max-h-60 overflow-auto mt-1 ring-1 ring-black/5">
                                        {products.slice(0, 10).map(p => (
                                            <div
                                                key={p.id}
                                                className="p-3 hover:bg-tertiary cursor-pointer border-b border-border last:border-0"
                                                onClick={() => {
                                                    setSelectedProduct(p);
                                                    setSearchProduct(p.name);
                                                }}
                                            >
                                                <div className="font-medium text-primary">{p.name}</div>
                                                <div className="flex items-center justify-between text-xs text-muted mt-1">
                                                    <span className="flex items-center gap-1">
                                                        <Barcode size={12} /> {p.barcode}
                                                    </span>
                                                    <span className="font-bold text-accent">{p.purchase_price} DH</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* "New Product" Prompt if no results */}
                                {searchProduct.length > 1 && products.length === 0 && (
                                    <div className="absolute top-full left-0 right-0 bg-secondary border rounded-lg shadow-lg z-20 p-2 mt-1 text-center">
                                        <p className="text-sm text-muted mb-2">Aucun produit trouvé</p>
                                        <button
                                            onClick={() => setShowCreateProduct(true)}
                                            className="btn-primary-outline text-xs w-full"
                                        >
                                            <Plus size={14} className="inline mr-1" /> Créer "{searchProduct}"
                                        </button>
                                    </div>
                                )}
                            </div>

                            <input
                                type="number"
                                min={1}
                                value={itemQty}
                                onChange={(e) => setItemQty(parseInt(e.target.value) || 1)}
                                className="input w-20 text-center h-[42px]"
                                placeholder="Qté"
                            />

                            <button
                                onClick={addItem}
                                disabled={!selectedProduct}
                                className="btn-secondary h-[42px]"
                                title="Ajouter à la liste"
                            >
                                <Plus size={18} />
                            </button>

                            <button
                                onClick={() => setShowCreateProduct(true)}
                                className="btn-primary h-[42px]"
                                title="Créer un nouveau produit"
                            >
                                <Plus size={18} /> Nouveau Produit
                            </button>
                        </div>
                    </div>

                    {/* Items List */}
                    {formData.items.length > 0 && (
                        <div className="mb-4">
                            <h3 className="font-medium mb-2">Articles ({formData.items.length})</h3>
                            <div className="space-y-2 border rounded-lg overflow-hidden">
                                <div className="bg-tertiary px-3 py-2 text-xs font-semibold uppercase text-muted flex">
                                    <div className="flex-1">Produit</div>
                                    <div className="w-24 text-right">Prix Achat</div>
                                    <div className="w-24 text-right">Prix Vente</div>
                                    <div className="w-20 text-center">Qté</div>
                                    <div className="w-24 text-right">Total</div>
                                    <div className="w-10"></div>
                                </div>
                                {formData.items.map((item) => (
                                    <div key={item.product} className="flex items-center p-3 border-t border-border hover:bg-tertiary/30 gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{item.productName || `Produit #${item.product}`}</div>
                                            <div className="text-xs text-muted flex items-center gap-1">
                                                <Barcode size={10} /> {item.barcode || '---'}
                                            </div>
                                        </div>
                                        <div className="w-24">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={item.unit_cost}
                                                onChange={(e) => {
                                                    const newCost = Number(e.target.value);
                                                    setFormData({
                                                        ...formData,
                                                        items: formData.items.map(i =>
                                                            i.product === item.product
                                                                ? { ...i, unit_cost: Number.isFinite(newCost) ? newCost : 0 }
                                                                : i
                                                        ),
                                                    });
                                                }}
                                                className="w-full text-right text-sm py-1 px-2"
                                                title="Prix d'achat négocié pour cette commande (DH)"
                                            />
                                        </div>
                                        <div className="w-24">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={item.sale_price}
                                                onChange={(e) => {
                                                    const newSalePrice = Number(e.target.value);
                                                    setFormData({
                                                        ...formData,
                                                        items: formData.items.map(i =>
                                                            i.product === item.product
                                                                ? { ...i, sale_price: Number.isFinite(newSalePrice) ? newSalePrice : 0 }
                                                                : i
                                                        ),
                                                    });
                                                }}
                                                className="w-full text-right text-sm py-1 px-2"
                                                title="Prix de vente qui sera appliquÃ© au stock et Ã  la caisse Ã  la rÃ©ception"
                                            />
                                        </div>
                                        <div className="w-20">
                                            <input
                                                type="number"
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    const newQty = Math.max(1, Math.floor(Number(e.target.value) || 1));
                                                    setFormData({
                                                        ...formData,
                                                        items: formData.items.map(i =>
                                                            i.product === item.product
                                                                ? { ...i, quantity: newQty }
                                                                : i
                                                        ),
                                                    });
                                                }}
                                                className="w-full text-center text-sm py-1 px-2 font-bold"
                                            />
                                        </div>
                                        <div className="w-24 text-right font-bold text-accent">
                                            {(item.quantity * item.unit_cost).toFixed(2)}
                                        </div>
                                        <div className="w-10 text-right">
                                            <button onClick={() => removeItem(item.product)} className="text-danger hover:bg-danger/10 p-1 rounded">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div className="bg-tertiary/50 p-3 flex justify-end items-center border-t border-border">
                                    <span className="text-muted mr-3">Total achat estimé:</span>
                                    <span className="text-xl font-bold">{orderTotal.toFixed(2)} DH</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1">Notes</label>
                        <textarea
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            className="input w-full h-20 resize-none"
                            placeholder="Notes pour le fournisseur..."
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-border">
                        <button onClick={handleSubmit} disabled={createOrder.isPending} className="btn-primary flex-1 py-3 text-lg">
                            {createOrder.isPending ? 'Création...' : 'Valider la Commande'}
                        </button>
                        <button onClick={resetForm} className="btn-secondary px-6">Annuler</button>
                    </div>
                </div>
            )}

            {/* Orders List */}
            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold">Historique des Commandes</h2>
                </div>
                <div className="divide-y">
                    {isLoading ? (
                        <div className="p-8 text-center text-muted">Chargement...</div>
                    ) : orders.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <ClipboardList size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Aucune commande</p>
                        </div>
                    ) : (
                        orders.map((order) => (
                            <div key={order.id} className="p-4">
                                <div
                                    className="flex items-center justify-between cursor-pointer"
                                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-tertiary rounded-full flex items-center justify-center">
                                            <Package size={20} className="text-muted" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{order.reference}</p>
                                            <div className="flex items-center gap-2 text-sm text-muted">
                                                <span>{order.supplier_name || `Fournisseur #${order.supplier}`}</span>
                                                <span>•</span>
                                                <span className="flex items-center gap-1">
                                                    <Calendar size={12} /> {new Date(order.created_at).toLocaleDateString('fr-FR')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`badge ${getStatusBadge(order.status)}`}>
                                            {order.status_display || order.status}
                                        </span>
                                        <span className="font-bold">{order.total_amount?.toFixed(2) || '0.00'} DH</span>
                                        {expandedOrder === order.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </div>

                                {expandedOrder === order.id && (
                                    <div className="mt-4 pl-14 space-y-3">
                                        <div className="bg-tertiary/20 rounded-lg p-3">
                                            {/* Order Items Detail */}
                                            <h4 className="font-medium text-sm mb-2">Détails de la commande</h4>
                                            {order.status === 'PARTIAL' && (
                                                <div className="text-xs text-warning mb-2 flex items-center gap-1">
                                                    <AlertTriangle size={12} />
                                                    Cette commande est partiellement reçue. Les quantités affichées ci-dessous sont le total commandé.
                                                </div>
                                            )}
                                            <div className="space-y-1">
                                                {asArray<PurchaseOrderItem>(order.items).map(item => (
                                                    <div key={item.id} className="py-2 border-b border-border/50 last:border-0">
                                                        <div className="flex justify-between text-sm items-center">
                                                            <div>
                                                            <span>{item.product_name}</span>
                                                            {/* Show verification progress if received > 0 */}
                                                            {(item.received_quantity > 0 || order.status === 'PARTIAL') && (
                                                                <span className="text-xs text-muted ml-2">
                                                                    (Reçu: <span className={item.received_quantity >= item.quantity ? 'text-success' : 'text-warning'}>
                                                                        {item.received_quantity}/{item.quantity}
                                                                    </span>)
                                                                </span>
                                                            )}
                                                            {!(item.received_quantity > 0 || order.status === 'PARTIAL') && (
                                                                <span className="text-xs text-muted ml-2">x {item.quantity}</span>
                                                            )}
                                                            </div>
                                                            <span>{item.unit_cost} DH</span>
                                                        </div>
                                                        {asArray<StockLayer>(item.product_layers).length > 0 && (
                                                            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                {asArray<StockLayer>(item.product_layers).map((layer, idx) => (
                                                                    <div key={`${item.id}-${idx}`} className="rounded-lg bg-secondary border border-border px-3 py-2 text-xs">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="font-semibold">Lot FIFO #{idx + 1}</span>
                                                                            <span className="badge badge-accent">{layer.remaining_quantity}/{layer.initial_quantity} pcs</span>
                                                                        </div>
                                                                        <div className="mt-1 flex justify-between text-muted">
                                                                            <span>Achat {Number(layer.unit_cost).toFixed(2)} DH</span>
                                                                            <span>Vente {Number(layer.sale_price).toFixed(2)} DH</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {order.notes && (
                                            <p className="text-sm bg-tertiary/50 p-2 rounded italic">{order.notes}</p>
                                        )}

                                        <div className="flex gap-2 pt-2">
                                            {order.status === 'DRAFT' && (
                                                <>
                                                    <button
                                                        onClick={() => sendOrder.mutate(order.id)}
                                                        className="btn-info flex items-center gap-1 text-sm"
                                                    >
                                                        <Send size={16} /> Envoyer
                                                    </button>
                                                    <button
                                                        onClick={() => cancelOrder.mutate(order.id)}
                                                        className="btn-danger flex items-center gap-1 text-sm"
                                                    >
                                                        <X size={16} /> Annuler
                                                    </button>
                                                </>
                                            )}
                                            {(order.status === 'SENT' || (order.status === 'PARTIAL' && !receiveOrder.isPending)) && (
                                                <button
                                                    onClick={() => handleReceiveClick(order)}
                                                    className="btn-success flex items-center gap-1 text-sm"
                                                    disabled={receiveOrder.isPending}
                                                >
                                                    <Check size={16} />
                                                    {receiveOrder.isPending ? 'Mise à jour...' : 'Confirmer la Réception (Ajouter au Stock)'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Product Creation Modal */}
            {showCreateProduct && (
                <ProductCreateModal
                    onClose={() => setShowCreateProduct(false)}
                    onSuccess={handleProductCreated}
                    initialName={searchProduct}
                />
            )}

            {/* Receive Order Modal */}
            {receivingOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleReceiveCancel} />
                    <div className="relative card w-full max-w-5xl max-h-[90vh] overflow-y-auto p-0 animate-slideUp">
                        <div className="card-header sticky top-0 bg-secondary z-10 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <Check size={22} className="text-success" />
                                    Réception — {receivingOrder.reference}
                                </h2>
                                <p className="text-sm text-muted mt-1">
                                    Saisis les quantités réellement reçues. Tu peux ajuster le prix
                                    payé si le fournisseur l'a modifié, et propager ce nouveau prix
                                    sur la fiche produit.
                                </p>
                            </div>
                            <button
                                onClick={handleReceiveCancel}
                                className="btn-ghost btn-icon"
                                aria-label="Fermer"
                            >
                                <X size={22} />
                            </button>
                        </div>

                        <div className="p-6 space-y-3">
                            {receiveDrafts.map(draft => {
                                const qty = Number(draft.quantity) || 0;
                                const cost = Number(draft.unit_cost) || 0;
                                const lineTotal = qty * cost;
                                const tooMany = qty > draft.remaining;
                                return (
                                    <div
                                        key={draft.item_id}
                                        className="border rounded-lg p-4 bg-tertiary/30 space-y-3"
                                    >
                                        <div className="flex items-start justify-between gap-3 flex-wrap">
                                            <div className="min-w-0">
                                                <p className="font-bold">{draft.product_name}</p>
                                                <p className="text-xs text-muted flex items-center gap-1">
                                                    <Barcode size={10} /> {draft.barcode || '---'}
                                                </p>
                                                <p className="text-xs text-muted mt-1">
                                                    Commandé : <b>{draft.ordered_qty}</b>
                                                    {draft.already_received > 0 && (
                                                        <> · Déjà reçu : <b className="text-warning">{draft.already_received}</b></>
                                                    )}
                                                    {' '}· Restant : <b className="text-success">{draft.remaining}</b>
                                                </p>
                                            </div>
                                            <div className="text-right text-sm">
                                                <span className="text-muted">Total ligne </span>
                                                <span className="font-bold text-accent">{lineTotal.toFixed(2)} DH</span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-xs font-semibold text-muted mb-1">
                                                    Quantité reçue
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={draft.remaining}
                                                    value={draft.quantity}
                                                    onChange={(e) => updateDraft(draft.item_id, { quantity: e.target.value })}
                                                    className={`w-full text-center font-bold ${tooMany ? 'border-danger' : ''}`}
                                                />
                                                {tooMany && (
                                                    <p className="text-xs text-danger mt-1">
                                                        Max {draft.remaining}
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-muted mb-1">
                                                    Prix d'achat appliqué (DH)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={draft.unit_cost}
                                                    onChange={(e) => updateDraft(draft.item_id, { unit_cost: e.target.value })}
                                                    className="w-full text-right"
                                                />
                                                <p className="text-xs text-muted mt-1">
                                                    Crée un nouveau lot FIFO à ce prix.
                                                </p>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-muted mb-1">
                                                    Nouveau prix de vente (optionnel)
                                                </label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={draft.new_sale_price}
                                                    onChange={(e) => updateDraft(draft.item_id, { new_sale_price: e.target.value })}
                                                    placeholder={`actuel : ${draft.current_sale_price.toFixed(2)}`}
                                                    className="w-full text-right"
                                                />
                                                <p className="text-xs text-muted mt-1">
                                                    Si rempli, met à jour la fiche produit.
                                                </p>
                                            </div>
                                        </div>

                                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={draft.update_purchase_price}
                                                onChange={(e) => updateDraft(draft.item_id, { update_purchase_price: e.target.checked })}
                                            />
                                            <span>
                                                Mettre à jour aussi le <b>prix d'achat par défaut</b> du produit
                                                (pour les prochaines commandes)
                                            </span>
                                        </label>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="card-header sticky bottom-0 bg-secondary z-10 flex items-center justify-end gap-3 border-t">
                            <button onClick={handleReceiveCancel} className="btn-secondary">
                                Annuler
                            </button>
                            <button
                                onClick={handleReceiveConfirm}
                                disabled={receiveOrder.isPending}
                                className="btn-primary flex items-center gap-2"
                            >
                                <Check size={18} />
                                {receiveOrder.isPending ? 'Enregistrement…' : 'Confirmer la réception'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
