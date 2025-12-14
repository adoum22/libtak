import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useToast } from '../components/Toast';
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
    Calendar
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
    stock: number;
}

interface PurchaseOrderItem {
    id: number;
    product: number;
    product_name?: string;
    quantity: number;
    unit_cost: number;
    received_quantity: number;
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

export default function PurchaseOrders() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [showForm, setShowForm] = useState(false);
    const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
    const [formData, setFormData] = useState({
        supplier: '',
        notes: '',
        expected_date: '',
        items: [] as { product: number; quantity: number; unit_cost: number; productName?: string }[]
    });
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [itemQty, setItemQty] = useState(1);
    const [searchProduct, setSearchProduct] = useState('');

    // Fetch orders
    const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
        queryKey: ['purchaseOrders'],
        queryFn: () => client.get('/inventory/purchase-orders/').then(res => res.data.results || res.data)
    });

    // Fetch suppliers
    const { data: suppliers = [] } = useQuery<Supplier[]>({
        queryKey: ['suppliers'],
        queryFn: () => client.get('/inventory/suppliers/').then(res => {
            const data = res.data;
            return Array.isArray(data) ? data : (data.results || []);
        })
    });

    // Search products
    const { data: products = [] } = useQuery<Product[]>({
        queryKey: ['products', searchProduct],
        queryFn: () => client.get(`/inventory/products/?search=${searchProduct}`).then(res => res.data.results || res.data),
        enabled: searchProduct.length > 1
    });

    // Create order
    const createOrder = useMutation({
        mutationFn: (data: any) => client.post('/inventory/purchase-orders/', data),
        onSuccess: () => {
            toast.success('Commande créée');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            resetForm();
        },
        onError: () => toast.error('Erreur lors de la création')
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
        mutationFn: (id: number) => client.post(`/inventory/purchase-orders/${id}/receive/`),
        onSuccess: () => {
            toast.success('Commande reçue - Stock mis à jour');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
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
                    productName: selectedProduct.name
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
        if (!formData.supplier || formData.items.length === 0) {
            toast.error('Sélectionnez un fournisseur et ajoutez des articles');
            return;
        }
        createOrder.mutate({
            supplier: parseInt(formData.supplier),
            notes: formData.notes,
            expected_date: formData.expected_date || null,
            items: formData.items.map(({ product, quantity, unit_cost }) => ({ product, quantity, unit_cost }))
        });
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

                    {/* Add Product */}
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1">Ajouter un produit</label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input
                                    type="text"
                                    placeholder="Rechercher un produit..."
                                    className="input w-full"
                                    value={searchProduct}
                                    onChange={(e) => setSearchProduct(e.target.value)}
                                />
                                {products.length > 0 && searchProduct && (
                                    <div className="absolute top-full left-0 right-0 bg-surface border rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
                                        {products.slice(0, 10).map(p => (
                                            <div
                                                key={p.id}
                                                className="p-2 hover:bg-tertiary cursor-pointer"
                                                onClick={() => {
                                                    setSelectedProduct(p);
                                                    setSearchProduct(p.name);
                                                }}
                                            >
                                                <div className="font-medium">{p.name}</div>
                                                <div className="text-xs text-muted">{p.barcode} - {p.purchase_price} DH</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <input
                                type="number"
                                min={1}
                                value={itemQty}
                                onChange={(e) => setItemQty(parseInt(e.target.value) || 1)}
                                className="input w-20 text-center"
                                placeholder="Qté"
                            />
                            <button
                                onClick={addItem}
                                disabled={!selectedProduct}
                                className="btn-secondary"
                            >
                                <Plus size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Items List */}
                    {formData.items.length > 0 && (
                        <div className="mb-4">
                            <h3 className="font-medium mb-2">Articles ({formData.items.length})</h3>
                            <div className="space-y-2">
                                {formData.items.map((item) => (
                                    <div key={item.product} className="flex items-center justify-between p-2 bg-tertiary rounded">
                                        <span>{item.productName || `Produit #${item.product}`}</span>
                                        <div className="flex items-center gap-4">
                                            <span>{item.quantity} x {item.unit_cost.toFixed(2)} DH</span>
                                            <span className="font-bold">{(item.quantity * item.unit_cost).toFixed(2)} DH</span>
                                            <button onClick={() => removeItem(item.product)} className="text-danger">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex justify-end pt-2 border-t">
                                    <span className="text-lg font-bold">Total: {orderTotal.toFixed(2)} DH</span>
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
                    <div className="flex gap-3">
                        <button onClick={handleSubmit} disabled={createOrder.isPending} className="btn-primary flex-1">
                            {createOrder.isPending ? 'Création...' : 'Créer la Commande'}
                        </button>
                        <button onClick={resetForm} className="btn-secondary">Annuler</button>
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
                                            <p className="text-sm text-muted">{order.supplier_name || `Fournisseur #${order.supplier}`}</p>
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
                                        <div className="text-sm text-muted">
                                            Créée le {new Date(order.created_at).toLocaleDateString('fr-FR')}
                                            {order.expected_date && ` • Prévue le ${order.expected_date}`}
                                        </div>
                                        {order.notes && (
                                            <p className="text-sm bg-tertiary/50 p-2 rounded">{order.notes}</p>
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
                                            {order.status === 'SENT' && (
                                                <button
                                                    onClick={() => receiveOrder.mutate(order.id)}
                                                    className="btn-success flex items-center gap-1 text-sm"
                                                >
                                                    <Check size={16} /> Marquer Reçue
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
        </div>
    );
}
