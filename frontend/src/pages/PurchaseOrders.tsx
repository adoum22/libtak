import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import ProductCreateModal from '../components/ProductCreateModal';
import Pagination from '../components/Pagination';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import {
    buildReceiveOrderItem,
    type ReceiveOrderItem,
} from '../utils/purchaseOrderReceipt';
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
    AlertTriangle,
    Banknote,
    CreditCard,
    RotateCcw,
    Wallet,
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
    created_at: string;
    note?: string;
}

type PurchaseOrderForm = {
    supplier: number;
    notes: string;
    expected_date: string | null;
    items: Array<{ product: number; quantity: number; unit_cost: number; sale_price?: number }>;
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
    paid_amount: number;
    balance_due: number;
    payment_status: 'UNPAID' | 'PARTIAL' | 'PAID';
    payments: SupplierPayment[];
    items_count: number;
    items: PurchaseOrderItem[];
    created_at: string;
}

interface SupplierPayment {
    id: number;
    amount: string | number;
    method: 'CASH' | 'BANK' | 'OTHER';
    method_display: string;
    paid_on: string;
    reference: string;
    note: string;
    status: 'ACTIVE' | 'REVERSED';
    created_by_name: string | null;
    created_at: string;
    reversed_by_name: string | null;
    reversed_at: string | null;
    reversal_reason: string;
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

type PurchaseOrdersPage = {
    count: number;
    results: PurchaseOrder[];
};

const PAGE_SIZE = 50;

const normalizeOrder = (order: PurchaseOrder): PurchaseOrder => ({
    ...order,
    items: asArray<PurchaseOrderItem>(order.items),
    payments: asArray<SupplierPayment>(order.payments),
    total_amount: Number(order.total_amount) || 0,
    paid_amount: Number(order.paid_amount) || 0,
    balance_due: Number(order.balance_due) || 0,
});

const localDateInput = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export default function PurchaseOrders() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [showForm, setShowForm] = useState(false);
    const [showCreateProduct, setShowCreateProduct] = useState(false);
    const [page, setPage] = useState(1);
    const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
    const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
    const [receiveDrafts, setReceiveDrafts] = useState<ReceiveDraft[]>([]);
    const [receiptId, setReceiptId] = useState(() => globalThis.crypto.randomUUID());
    const [payingOrder, setPayingOrder] = useState<PurchaseOrder | null>(null);
    const [paymentOperationId, setPaymentOperationId] = useState(
        () => globalThis.crypto.randomUUID(),
    );
    const [paymentForm, setPaymentForm] = useState({
        amount: '',
        method: 'CASH' as SupplierPayment['method'],
        paid_on: localDateInput(),
        reference: '',
        note: '',
    });
    const [reversingPayment, setReversingPayment] = useState<{
        order: PurchaseOrder;
        payment: SupplierPayment;
    } | null>(null);
    const [reversalReason, setReversalReason] = useState('');
    const [reversalOperationId, setReversalOperationId] = useState(
        () => globalThis.crypto.randomUUID(),
    );
    const [formData, setFormData] = useState({
        supplier: '',
        notes: '',
        expected_date: '',
        items: [] as {
            product: number;
            quantity: number;
            unit_cost: string;
            sale_price: string;
            productName?: string;
            barcode?: string;
        }[]
    });
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [itemQty, setItemQty] = useState(1);
    const [searchProduct, setSearchProduct] = useState('');

    // Fetch orders
    const { data: ordersPage, isLoading, isError, refetch } = useQuery<PurchaseOrdersPage>({
        queryKey: ['purchaseOrders', page],
        queryFn: () => client
            .get(`/inventory/purchase-orders/?page=${page}`)
            .then(res => ({
                count: Number(res.data?.count ?? asArray<PurchaseOrder>(res.data).length),
                results: asArray<PurchaseOrder>(res.data).map(normalizeOrder),
            })),
        placeholderData: previous => previous,
    });
    const orders = ordersPage?.results ?? [];
    const ordersCount = ordersPage?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(ordersCount / PAGE_SIZE));

    // Fetch suppliers
    const { data: suppliers = [], isError: suppliersError } = useQuery<Supplier[]>({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => asArray<Supplier>(res.data))
    });

    // Search products
    const { data: products = [], isError: productsError } = useQuery<Product[]>({
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
            toast.error(getApiErrorMessage(err, 'Impossible de créer la commande. Réessayez.'));
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
        mutationFn: ({ id, items, receipt_id }: { id: number, items: ReceiveOrderItem[], receipt_id: string }) =>
            client.post(`/inventory/purchase-orders/${id}/receive/`, { items, receipt_id }),
        onSuccess: () => {
            toast.success('Réception validée - Stock mis à jour');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            setReceiptId(globalThis.crypto.randomUUID());
        },
        onError: () => {
            toast.error('La réception n’a pas pu être enregistrée. Vous pouvez réessayer sans risque de doublon.');
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

    const createPayment = useMutation({
        mutationFn: ({ orderId, payload }: {
            orderId: number;
            payload: typeof paymentForm & { operation_id: string };
        }) => client.post(
            `/inventory/purchase-orders/${orderId}/payments/`,
            payload,
        ),
        onSuccess: () => {
            toast.success('Règlement fournisseur enregistré.');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            setPayingOrder(null);
            setPaymentOperationId(globalThis.crypto.randomUUID());
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(
                error,
                'Impossible d’enregistrer le règlement.',
            ));
        },
    });

    const reversePayment = useMutation({
        mutationFn: ({ orderId, paymentId, reason, operationId }: {
            orderId: number;
            paymentId: number;
            reason: string;
            operationId: string;
        }) => client.post(
            `/inventory/purchase-orders/${orderId}/payments/${paymentId}/reverse/`,
            { reason, operation_id: operationId },
        ),
        onSuccess: () => {
            toast.success('Règlement fournisseur contrepassé.');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            setReversingPayment(null);
            setReversalReason('');
            setReversalOperationId(globalThis.crypto.randomUUID());
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(
                error,
                'Impossible de contrepasser le règlement.',
            ));
        },
    });

    const openPayment = (order: PurchaseOrder) => {
        setPayingOrder(order);
        setPaymentForm({
            amount: order.balance_due.toFixed(2),
            method: 'CASH',
            paid_on: localDateInput(),
            reference: '',
            note: '',
        });
        setPaymentOperationId(globalThis.crypto.randomUUID());
    };

    const submitPayment = () => {
        if (!payingOrder) return;
        const amount = parseDecimalInput(paymentForm.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error('Saisissez un montant positif.');
            return;
        }
        if (amount > payingOrder.balance_due + 0.0001) {
            toast.error('Le montant dépasse le solde restant.');
            return;
        }
        createPayment.mutate({
            orderId: payingOrder.id,
            payload: {
                ...paymentForm,
                amount: amount.toFixed(2),
                reference: paymentForm.reference.trim(),
                note: paymentForm.note.trim(),
                operation_id: paymentOperationId,
            },
        });
    };

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
                    unit_cost: String(selectedProduct.purchase_price ?? 0),
                    sale_price: String(selectedProduct.sale_price_ht ?? selectedProduct.price_ttc ?? 0),
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
                unit_cost: parseDecimalInput(unit_cost) || 0,
                sale_price: parseDecimalInput(sale_price) || 0,
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

        if (receiveDrafts.some(d => (Number(d.quantity) || 0) > d.remaining)) {
            toast.error('Une quantité reçue dépasse la quantité restante.');
            return;
        }

        const items: ReceiveOrderItem[] = receiveDrafts
            .map(buildReceiveOrderItem)
            .filter((item): item is ReceiveOrderItem => item !== null);

        if (items.length === 0) {
            toast.error('Aucune quantité à réceptionner.');
            return;
        }

        receiveOrder.mutate(
            { id: receivingOrder.id, items, receipt_id: receiptId },
            {
                onSuccess: () => {
                    setReceivingOrder(null);
                    setReceiveDrafts([]);
                },
            }
        );
    };

    const handleReceiveCancel = () => {
        if (receiveOrder.isPending) return;
        setReceivingOrder(null);
        setReceiveDrafts([]);
        setReceiptId(globalThis.crypto.randomUUID());
    };

    const handleProductCreated = (newProduct: CreatedProduct) => {
        // Automatically add the created product to the list
        setFormData({
            ...formData,
            items: [...formData.items, {
                product: newProduct.id,
                quantity: 1,
                unit_cost: String(newProduct.purchase_price ?? 0),
                sale_price: '0',
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

    const orderTotal = formData.items.reduce(
        (sum, item) => sum + item.quantity * (parseDecimalInput(item.unit_cost) || 0),
        0,
    );

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
                <button type="button" onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2" aria-expanded={showForm} aria-controls="purchase-order-form">
                    <Plus size={18} />
                    Nouvelle Commande
                </button>
            </div>

            {/* Create Order Form */}
            {showForm && (
                <form id="purchase-order-form" className="card p-6 border-accent border-2" onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
                    <h2 className="text-xl font-bold mb-4">Nouvelle Commande</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium mb-1" htmlFor="purchase-order-supplier">Fournisseur *</label>
                            <select
                                id="purchase-order-supplier"
                                value={formData.supplier}
                                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
                                className="input w-full"
                            >
                                <option value="">{suppliersError ? 'Fournisseurs indisponibles' : 'Sélectionner…'}</option>
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1" htmlFor="purchase-order-date">Date prévue</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                <input
                                    id="purchase-order-date"
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
                        <label className="block text-sm font-medium mb-2" htmlFor="purchase-order-product-search">Ajouter des articles</label>
                        <div className="flex flex-wrap gap-2 items-start">
                            <div className="flex-1 min-w-[250px] relative z-50">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                                    <input
                                        id="purchase-order-product-search"
                                        type="text"
                                        placeholder="Nom ou Code-barres..."
                                        className="input w-full pl-10"
                                        value={searchProduct}
                                        onChange={(e) => {
                                            setSearchProduct(e.target.value);
                                            setSelectedProduct(null);
                                        }}
                                        role="combobox"
                                        aria-autocomplete="list"
                                        aria-controls="purchase-product-suggestions"
                                        aria-expanded={products.length > 0 && Boolean(searchProduct) && !selectedProduct}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && products.length > 0) {
                                                e.preventDefault();
                                                setSelectedProduct(products[0]);
                                                setSearchProduct(products[0].name);
                                            }
                                        }}
                                    />
                                </div>

                                {/* Product Suggestions Dropdown */}
                                {products.length > 0 && searchProduct && !selectedProduct && (
                                    <ul id="purchase-product-suggestions" role="listbox" className="absolute top-full left-0 right-0 bg-secondary border rounded-lg shadow-xl z-[100] max-h-60 overflow-auto mt-1 ring-1 ring-black/5">
                                        {products.slice(0, 10).map(p => (
                                            <li key={p.id} role="option" aria-selected={false}>
                                                <button
                                                    type="button"
                                                    className="w-full p-3 hover:bg-tertiary border-b border-border last:border-0 text-left"
                                                    onClick={() => { setSelectedProduct(p); setSearchProduct(p.name); }}
                                                >
                                                    <div className="font-medium text-primary">{p.name}</div>
                                                    <div className="flex items-center justify-between text-xs text-muted mt-1">
                                                        <span className="flex items-center gap-1">
                                                            <Barcode size={12} /> {p.barcode}
                                                        </span>
                                                        <span className="font-bold text-accent">{p.purchase_price} DH</span>
                                                    </div>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {productsError && searchProduct.length > 1 && (
                                    <p className="text-sm text-danger mt-2" role="alert">La recherche de produits est indisponible.</p>
                                )}

                                {/* "New Product" Prompt if no results */}
                                {searchProduct.length > 1 && products.length === 0 && !productsError && (
                                    <div className="absolute top-full left-0 right-0 bg-secondary border rounded-lg shadow-lg z-20 p-2 mt-1 text-center">
                                        <p className="text-sm text-muted mb-2">Aucun produit trouvé</p>
                                        <button
                                            type="button"
                                            onClick={() => setShowCreateProduct(true)}
                                            className="btn-primary-outline text-xs w-full"
                                        >
                                            <Plus size={14} className="inline mr-1" /> Créer "{searchProduct}"
                                        </button>
                                    </div>
                                )}
                            </div>

                            <input
                                aria-label="Quantité à ajouter"
                                type="number"
                                min={1}
                                value={itemQty}
                                onChange={(e) => setItemQty(parseInt(e.target.value) || 1)}
                                className="input w-20 text-center h-[42px]"
                                placeholder="Qté"
                            />

                            <button
                                type="button"
                                onClick={addItem}
                                disabled={!selectedProduct}
                                className="btn-secondary h-[42px]"
                                title="Ajouter à la liste"
                                aria-label="Ajouter le produit sélectionné à la commande"
                            >
                                <Plus size={18} />
                            </button>

                            <button
                                type="button"
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
                                    <div className="w-24 text-right">Prix vente prévu</div>
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
                                                aria-label={`Prix d'achat de ${item.productName || `produit ${item.product}`}`}
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                    inputMode="decimal"
                                                    value={item.unit_cost}
                                                onChange={(e) => {
                                                    setFormData({
                                                        ...formData,
                                                        items: formData.items.map(i =>
                                                            i.product === item.product
                                                                ? { ...i, unit_cost: normalizeDecimalInput(e.target.value) }
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
                                                aria-label={`Prix de vente de ${item.productName || `produit ${item.product}`}`}
                                                type="text"
                                                step="0.01"
                                                min="0"
                                                    inputMode="decimal"
                                                    value={item.sale_price}
                                                onChange={(e) => {
                                                    setFormData({
                                                        ...formData,
                                                        items: formData.items.map(i =>
                                                            i.product === item.product
                                                                ? { ...i, sale_price: normalizeDecimalInput(e.target.value) }
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
                                                aria-label={`Quantité de ${item.productName || `produit ${item.product}`}`}
                                                type="text"
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
                                            {(item.quantity * (parseDecimalInput(item.unit_cost) || 0)).toFixed(2)}
                                        </div>
                                        <div className="w-10 text-right">
                                            <button type="button" onClick={() => removeItem(item.product)} className="text-danger hover:bg-danger/10 p-1 rounded" aria-label={`Retirer ${item.productName || `produit ${item.product}`}`}>
                                                <Trash2 size={16} aria-hidden="true" />
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
                        <label className="block text-sm font-medium mb-1" htmlFor="purchase-order-notes">Notes</label>
                        <textarea
                            id="purchase-order-notes"
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            className="input w-full h-20 resize-none"
                            placeholder="Notes pour le fournisseur..."
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-border">
                        <button type="submit" disabled={createOrder.isPending} className="btn-primary flex-1 py-3 text-lg">
                            {createOrder.isPending ? 'Création...' : 'Valider la Commande'}
                        </button>
                        <button type="button" onClick={resetForm} className="btn-secondary px-6">Annuler</button>
                    </div>
                </form>
            )}

            {/* Orders List */}
            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold">Historique des Commandes</h2>
                </div>
                <div className="divide-y">
                    {isLoading ? (
                        <div className="p-8 text-center text-muted" role="status">Chargement…</div>
                    ) : isError ? (
                        <div className="network-error-state m-4" role="alert">
                            <p className="font-semibold">Impossible de charger les commandes.</p>
                            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
                                Réessayer
                            </button>
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <ClipboardList size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Aucune commande</p>
                        </div>
                    ) : (
                        orders.map((order) => (
                            <div key={order.id} className="p-4">
                                <button
                                    type="button"
                                    className="w-full flex items-center justify-between text-left"
                                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                                    aria-expanded={expandedOrder === order.id}
                                    aria-controls={`purchase-order-${order.id}`}
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
                                </button>

                                {expandedOrder === order.id && (
                                    <div id={`purchase-order-${order.id}`} className="mt-4 pl-14 space-y-3">
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
                                                                        <div className="mt-1 text-muted">
                                                                            <span>Achat {Number(layer.unit_cost).toFixed(2)} DH</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="rounded-lg border border-border bg-secondary p-3 space-y-3">
                                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                                <div className="flex items-center gap-2">
                                                    <Wallet size={18} className="text-accent" />
                                                    <h4 className="font-semibold text-sm">Règlements fournisseur</h4>
                                                </div>
                                                <div className="flex gap-3 text-sm flex-wrap">
                                                    <span>Payé : <b>{order.paid_amount.toFixed(2)} DH</b></span>
                                                    <span>Solde : <b className={order.balance_due > 0 ? 'text-warning' : 'text-success'}>{order.balance_due.toFixed(2)} DH</b></span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-muted">
                                                Mouvement de trésorerie uniquement : ces règlements ne réduisent ni la marge ni le bénéfice.
                                            </p>
                                            {order.payments.length === 0 ? (
                                                <p className="text-sm text-muted">Aucun règlement enregistré.</p>
                                            ) : (
                                                <div className="space-y-2">
                                                    {order.payments.map(payment => (
                                                        <div
                                                            key={payment.id}
                                                            className={`rounded-lg border px-3 py-2 text-sm ${payment.status === 'REVERSED' ? 'opacity-60' : ''}`}
                                                        >
                                                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                                                <div>
                                                                    <span className="font-semibold">{Number(payment.amount).toFixed(2)} DH</span>
                                                                    <span className="text-muted ml-2">
                                                                        {payment.method === 'CASH' ? 'Espèces' : payment.method === 'BANK' ? 'Banque' : 'Autre'} · {payment.paid_on}
                                                                    </span>
                                                                    {payment.reference && <span className="text-muted ml-2">Réf. {payment.reference}</span>}
                                                                </div>
                                                                {payment.status === 'ACTIVE' ? (
                                                                    <button
                                                                        type="button"
                                                                        className="btn-secondary text-xs"
                                                                        onClick={() => {
                                                                            setReversingPayment({ order, payment });
                                                                            setReversalReason('');
                                                                            setReversalOperationId(globalThis.crypto.randomUUID());
                                                                        }}
                                                                    >
                                                                        <RotateCcw size={14} /> Contrepasser
                                                                    </button>
                                                                ) : (
                                                                    <span className="badge badge-danger">Contrepassé</span>
                                                                )}
                                                            </div>
                                                            {payment.note && <p className="text-xs text-muted mt-1">{payment.note}</p>}
                                                            {payment.status === 'REVERSED' && payment.reversal_reason && (
                                                                <p className="text-xs text-danger mt-1">Motif : {payment.reversal_reason}</p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {order.balance_due > 0 && !['DRAFT', 'CANCELLED'].includes(order.status) && (
                                                <button
                                                    type="button"
                                                    className="btn-primary text-sm"
                                                    onClick={() => openPayment(order)}
                                                >
                                                    <CreditCard size={16} /> Enregistrer un règlement
                                                </button>
                                            )}
                                        </div>

                                        {order.notes && (
                                            <p className="text-sm bg-tertiary/50 p-2 rounded italic">{order.notes}</p>
                                        )}

                                        <div className="flex gap-2 pt-2">
                                            {order.status === 'DRAFT' && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendOrder.mutate(order.id)}
                                                        className="btn-info flex items-center gap-1 text-sm"
                                                    >
                                                        <Send size={16} /> Envoyer
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => cancelOrder.mutate(order.id)}
                                                        className="btn-danger flex items-center gap-1 text-sm"
                                                    >
                                                        <X size={16} /> Annuler
                                                    </button>
                                                </>
                                            )}
                                            {(order.status === 'SENT' || (order.status === 'PARTIAL' && !receiveOrder.isPending)) && (
                                                <button
                                                    type="button"
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
                {!isLoading && !isError && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        totalItems={ordersCount}
                        pageSize={PAGE_SIZE}
                        onPageChange={nextPage => {
                            setExpandedOrder(null);
                            setPage(nextPage);
                        }}
                    />
                )}
            </div>

            {/* Product Creation Modal */}
            {showCreateProduct && (
                <ProductCreateModal
                    onClose={() => setShowCreateProduct(false)}
                    onSuccess={handleProductCreated}
                    initialName={searchProduct}
                />
            )}

            {payingOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
                    <div className="relative card w-full max-w-lg p-0" role="dialog" aria-modal="true" aria-labelledby="supplier-payment-title">
                        <div className="card-header flex items-center justify-between">
                            <div>
                                <h2 id="supplier-payment-title" className="text-xl font-bold flex items-center gap-2">
                                    <Wallet size={20} className="text-accent" /> Règlement fournisseur
                                </h2>
                                <p className="text-sm text-muted mt-1">{payingOrder.reference} · solde {payingOrder.balance_due.toFixed(2)} DH</p>
                            </div>
                            <button type="button" className="btn-icon" aria-label="Fermer" disabled={createPayment.isPending} onClick={() => setPayingOrder(null)}><X size={20} /></button>
                        </div>
                        <div className="card-body space-y-4">
                            <label className="block">
                                <span className="text-sm font-semibold">Montant (DH)</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={paymentForm.amount}
                                    onChange={event => setPaymentForm(current => ({ ...current, amount: normalizeDecimalInput(event.target.value) }))}
                                    className="w-full mt-1"
                                    autoFocus
                                />
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label className="block">
                                    <span className="text-sm font-semibold">Mode</span>
                                    <select
                                        value={paymentForm.method}
                                        onChange={event => setPaymentForm(current => ({ ...current, method: event.target.value as SupplierPayment['method'] }))}
                                        className="w-full mt-1"
                                    >
                                        <option value="CASH">Espèces (sortie de caisse)</option>
                                        <option value="BANK">Banque</option>
                                        <option value="OTHER">Autre</option>
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="text-sm font-semibold">Date</span>
                                    <input type="date" value={paymentForm.paid_on} onChange={event => setPaymentForm(current => ({ ...current, paid_on: event.target.value }))} className="w-full mt-1" />
                                </label>
                            </div>
                            <label className="block">
                                <span className="text-sm font-semibold">Référence (optionnelle)</span>
                                <input value={paymentForm.reference} maxLength={100} onChange={event => setPaymentForm(current => ({ ...current, reference: event.target.value }))} className="w-full mt-1" placeholder="Virement, reçu, chèque…" />
                            </label>
                            <label className="block">
                                <span className="text-sm font-semibold">Note (optionnelle)</span>
                                <textarea value={paymentForm.note} onChange={event => setPaymentForm(current => ({ ...current, note: event.target.value }))} className="w-full mt-1" rows={2} />
                            </label>
                            <div className="rounded-lg bg-tertiary p-3 text-xs text-muted">
                                <Banknote size={15} className="inline mr-1" />
                                Un paiement en espèces réduit la caisse physique. Aucun mode ne modifie la marge ou le bénéfice.
                            </div>
                        </div>
                        <div className="card-header border-t flex justify-end gap-3">
                            <button type="button" className="btn-secondary" disabled={createPayment.isPending} onClick={() => setPayingOrder(null)}>Annuler</button>
                            <button type="button" className="btn-primary" disabled={createPayment.isPending} onClick={submitPayment}>
                                {createPayment.isPending ? 'Enregistrement…' : 'Enregistrer le règlement'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {reversingPayment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
                    <div className="relative card w-full max-w-md p-0" role="dialog" aria-modal="true" aria-labelledby="reverse-payment-title">
                        <div className="card-header">
                            <h2 id="reverse-payment-title" className="text-xl font-bold">Contrepasser le règlement</h2>
                            <p className="text-sm text-muted mt-1">
                                {Number(reversingPayment.payment.amount).toFixed(2)} DH · {reversingPayment.order.reference}
                            </p>
                        </div>
                        <div className="card-body">
                            <label className="block">
                                <span className="text-sm font-semibold">Motif obligatoire</span>
                                <textarea
                                    value={reversalReason}
                                    onChange={event => setReversalReason(event.target.value)}
                                    maxLength={255}
                                    rows={3}
                                    className="w-full mt-1"
                                    autoFocus
                                />
                            </label>
                            <p className="text-xs text-muted mt-3">L’historique sera conservé. Si le paiement était en espèces, le montant sera réintégré au solde théorique de caisse.</p>
                        </div>
                        <div className="card-header border-t flex justify-end gap-3">
                            <button type="button" className="btn-secondary" disabled={reversePayment.isPending} onClick={() => setReversingPayment(null)}>Annuler</button>
                            <button
                                type="button"
                                className="btn-danger"
                                disabled={!reversalReason.trim() || reversePayment.isPending}
                                onClick={() => reversePayment.mutate({
                                    orderId: reversingPayment.order.id,
                                    paymentId: reversingPayment.payment.id,
                                    reason: reversalReason.trim(),
                                    operationId: reversalOperationId,
                                })}
                            >
                                <RotateCcw size={16} /> {reversePayment.isPending ? 'Contrepassation…' : 'Confirmer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Receive Order Modal */}
            {receivingOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleReceiveCancel} aria-hidden="true" />
                    <div
                        className="relative card w-full max-w-5xl max-h-[90vh] overflow-y-auto p-0 animate-slideUp"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="receive-order-title"
                        aria-describedby="receive-order-description"
                    >
                        <div className="card-header sticky top-0 bg-secondary z-10 flex items-center justify-between">
                            <div>
                                <h2 id="receive-order-title" className="text-xl font-bold flex items-center gap-2">
                                    <Check size={22} className="text-success" />
                                    Réception — {receivingOrder.reference}
                                </h2>
                                <p id="receive-order-description" className="text-sm text-muted mt-1">
                                    Saisis les quantités réellement reçues. Tu peux ajuster le prix
                                    payé si le fournisseur l'a modifié, et propager ce nouveau prix
                                    sur la fiche produit.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={handleReceiveCancel}
                                disabled={receiveOrder.isPending}
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
                                                <label htmlFor={`receive-quantity-${draft.item_id}`} className="block text-xs font-semibold text-muted mb-1">
                                                    Quantité reçue
                                                </label>
                                                <input
                                                    id={`receive-quantity-${draft.item_id}`}
                                                    type="number"
                                                    min="0"
                                                    max={draft.remaining}
                                                    value={draft.quantity}
                                                    onChange={(e) => updateDraft(draft.item_id, { quantity: e.target.value })}
                                                    className={`w-full text-center font-bold ${tooMany ? 'border-danger' : ''}`}
                                                    aria-invalid={tooMany}
                                                    aria-describedby={tooMany ? `receive-quantity-error-${draft.item_id}` : undefined}
                                                />
                                                {tooMany && (
                                                    <p id={`receive-quantity-error-${draft.item_id}`} className="text-xs text-danger mt-1" role="alert">
                                                        Max {draft.remaining}
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label htmlFor={`receive-cost-${draft.item_id}`} className="block text-xs font-semibold text-muted mb-1">
                                                    Prix d'achat appliqué (DH)
                                                </label>
                                                <input
                                                    id={`receive-cost-${draft.item_id}`}
                                                    type="text"
                                                    step="0.01"
                                                    min="0"
                                                    inputMode="decimal"
                                                    value={draft.unit_cost}
                                                    onChange={(e) => updateDraft(draft.item_id, { unit_cost: normalizeDecimalInput(e.target.value) })}
                                                    className="w-full text-right"
                                                />
                                                <p className="text-xs text-muted mt-1">
                                                    Crée un nouveau lot FIFO à ce prix.
                                                </p>
                                            </div>
                                            <div>
                                                <label htmlFor={`receive-sale-price-${draft.item_id}`} className="block text-xs font-semibold text-muted mb-1">
                                                    Prix de vente unique après réception (optionnel)
                                                </label>
                                                <input
                                                    id={`receive-sale-price-${draft.item_id}`}
                                                    type="text"
                                                    step="0.01"
                                                    min="0"
                                                    inputMode="decimal"
                                                    value={draft.new_sale_price}
                                                    onChange={(e) => updateDraft(draft.item_id, { new_sale_price: normalizeDecimalInput(e.target.value) })}
                                                    placeholder={`actuel : ${draft.current_sale_price.toFixed(2)}`}
                                                    className="w-full text-right"
                                                />
                                                <p className="text-xs text-muted mt-1">
                                                    Si rempli, ce prix s'applique immédiatement à tout le stock, ancien et nouveau.
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
                            <button type="button" onClick={handleReceiveCancel} disabled={receiveOrder.isPending} className="btn-secondary">
                                Annuler
                            </button>
                            <button
                                type="button"
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
