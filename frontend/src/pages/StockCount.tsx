import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useToast } from '../components/Toast';
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

export default function StockCount() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [showForm, setShowForm] = useState(false);
    const [expandedCount, setExpandedCount] = useState<number | null>(null);
    const [countName, setCountName] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
    const [searchProduct, setSearchProduct] = useState('');
    const [countedValues, setCountedValues] = useState<Record<number, number>>({});

    // Fetch counts
    const { data: counts = [], isLoading } = useQuery<InventoryCount[]>({
        queryKey: ['inventoryCounts'],
        queryFn: () => client.get('/inventory/counts/').then(res => res.data.results || res.data)
    });

    // Search products
    const { data: products = [] } = useQuery<Product[]>({
        queryKey: ['products', searchProduct],
        queryFn: () => client.get(`/inventory/products/?search=${searchProduct}`).then(res => res.data.results || res.data),
        enabled: searchProduct.length > 1
    });

    // All products for counting
    const { data: allProducts = [] } = useQuery<Product[]>({
        queryKey: ['allProducts'],
        queryFn: () => client.get('/inventory/products/?limit=1000').then(res => res.data.results || res.data)
    });

    // Create count
    const createCount = useMutation({
        mutationFn: (data: { name: string; items: { product: number; expected_quantity: number }[] }) =>
            client.post('/inventory/counts/', data),
        onSuccess: () => {
            toast.success('Inventaire créé');
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
            resetForm();
        },
        onError: () => toast.error('Erreur lors de la création')
    });

    // Update count (save counted values)
    const updateCount = useMutation({
        mutationFn: ({ id, items }: { id: number; items: { id: number; counted_quantity: number }[] }) =>
            client.patch(`/inventory/counts/${id}/`, { items }),
        onSuccess: () => {
            toast.success('Comptage sauvegardé');
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
        }
    });

    // Complete count
    const completeCount = useMutation({
        mutationFn: (id: number) => client.post(`/inventory/counts/${id}/complete/`),
        onSuccess: () => {
            toast.success('Inventaire terminé');
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
        }
    });

    // Validate count (apply adjustments)
    const validateCount = useMutation({
        mutationFn: (id: number) => client.post(`/inventory/counts/${id}/validate/`),
        onSuccess: () => {
            toast.success('Inventaire validé - Stock ajusté');
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
        }
    });

    const resetForm = () => {
        setCountName('');
        setSelectedProducts([]);
        setShowForm(false);
        setSearchProduct('');
    };

    const addProduct = (product: Product) => {
        if (!selectedProducts.find(p => p.id === product.id)) {
            setSelectedProducts([...selectedProducts, product]);
        }
        setSearchProduct('');
    };

    const addAllProducts = () => {
        setSelectedProducts(allProducts);
    };

    const handleCreate = () => {
        if (!countName.trim() || selectedProducts.length === 0) {
            toast.error('Donnez un nom et sélectionnez des produits');
            return;
        }
        createCount.mutate({
            name: countName,
            items: selectedProducts.map(p => ({
                product: p.id,
                expected_quantity: p.stock
            }))
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
                        Inventaire Physique
                    </h1>
                    <p className="text-muted mt-1">Comptez et ajustez votre stock</p>
                </div>
                <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
                    <Plus size={18} />
                    Nouveau Comptage
                </button>
            </div>

            {/* Create Form */}
            {showForm && (
                <div className="card p-6 border-accent border-2">
                    <h2 className="text-xl font-bold mb-4">Nouveau Comptage</h2>

                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1">Nom de l'inventaire *</label>
                        <input
                            type="text"
                            value={countName}
                            onChange={(e) => setCountName(e.target.value)}
                            className="input w-full"
                            placeholder="Ex: Inventaire mensuel Décembre 2024"
                        />
                    </div>

                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium">Produits à compter</label>
                            <button onClick={addAllProducts} className="btn-sm btn-secondary">
                                Ajouter tous les produits
                            </button>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                            <input
                                type="text"
                                placeholder="Rechercher un produit..."
                                className="input w-full pl-10"
                                value={searchProduct}
                                onChange={(e) => setSearchProduct(e.target.value)}
                            />
                            {products.length > 0 && searchProduct && (
                                <div className="absolute top-full left-0 right-0 bg-white dark:bg-surface border border-gray-200 dark:border-border rounded-lg shadow-2xl z-50 max-h-48 overflow-auto mt-1">
                                    {products.map(p => (
                                        <div
                                            key={p.id}
                                            className="p-3 hover:bg-gray-100 dark:hover:bg-tertiary cursor-pointer border-b last:border-b-0"
                                            onClick={() => addProduct(p)}
                                        >
                                            <div className="font-medium text-black dark:text-white">{p.name}</div>
                                            <div className="text-xs text-gray-500 dark:text-muted">{p.barcode} - Stock: {p.stock}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {selectedProducts.length > 0 && (
                        <div className="mb-4 max-h-48 overflow-auto">
                            <p className="text-sm font-medium mb-2">{selectedProducts.length} produit(s) sélectionné(s)</p>
                            <div className="space-y-1">
                                {selectedProducts.slice(0, 20).map(p => (
                                    <div key={p.id} className="flex justify-between items-center p-2 bg-tertiary rounded text-sm">
                                        <span>{p.name}</span>
                                        <span className="text-muted">Stock: {p.stock}</span>
                                    </div>
                                ))}
                                {selectedProducts.length > 20 && (
                                    <p className="text-sm text-muted text-center">...et {selectedProducts.length - 20} autres</p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button onClick={handleCreate} disabled={createCount.isPending} className="btn-primary flex-1">
                            {createCount.isPending ? 'Création...' : 'Créer le Comptage'}
                        </button>
                        <button onClick={resetForm} className="btn-secondary">Annuler</button>
                    </div>
                </div>
            )}

            {/* Counts List */}
            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold">Historique des Inventaires</h2>
                </div>
                <div className="divide-y">
                    {isLoading ? (
                        <div className="p-8 text-center text-muted">Chargement...</div>
                    ) : counts.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <ClipboardCheck size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Aucun inventaire</p>
                        </div>
                    ) : (
                        counts.map((count) => (
                            <div key={count.id} className="p-4">
                                <div
                                    className="flex items-center justify-between cursor-pointer"
                                    onClick={() => setExpandedCount(expandedCount === count.id ? null : count.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-tertiary rounded-full flex items-center justify-center">
                                            <ClipboardCheck size={20} className="text-muted" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{count.name}</p>
                                            <p className="text-sm text-muted">
                                                {new Date(count.created_at).toLocaleDateString('fr-FR')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`badge ${getStatusBadge(count.status)}`}>
                                            {count.status_display || count.status}
                                        </span>
                                        {expandedCount === count.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </div>

                                {expandedCount === count.id && (
                                    <div className="mt-4 pl-14 space-y-3">
                                        {/* Items to count */}
                                        {count.status === 'IN_PROGRESS' && (
                                            <div className="space-y-2">
                                                <p className="text-sm font-medium">Saisissez les quantités comptées :</p>
                                                {count.items?.map((item) => (
                                                    <div key={item.id} className="flex items-center gap-4 p-2 bg-tertiary rounded">
                                                        <span className="flex-1">{item.product_name || `Produit #${item.product}`}</span>
                                                        <span className="text-sm text-muted">Attendu: {item.expected_quantity}</span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            placeholder="Compté"
                                                            className="input w-24 text-center"
                                                            value={countedValues[item.id] ?? item.counted_quantity ?? ''}
                                                            onChange={(e) => setCountedValues({
                                                                ...countedValues,
                                                                [item.id]: parseInt(e.target.value) || 0
                                                            })}
                                                        />
                                                    </div>
                                                ))}
                                                <div className="flex gap-2 pt-2">
                                                    <button
                                                        onClick={() => updateCount.mutate({
                                                            id: count.id,
                                                            items: Object.entries(countedValues).map(([id, qty]) => ({
                                                                id: parseInt(id),
                                                                counted_quantity: qty
                                                            }))
                                                        })}
                                                        className="btn-secondary flex items-center gap-1"
                                                    >
                                                        <Save size={16} /> Sauvegarder
                                                    </button>
                                                    <button
                                                        onClick={() => completeCount.mutate(count.id)}
                                                        className="btn-primary flex items-center gap-1"
                                                    >
                                                        <Check size={16} /> Terminer le comptage
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Completed - show differences */}
                                        {count.status === 'COMPLETED' && (
                                            <div>
                                                <p className="text-sm font-medium mb-2">Écarts détectés :</p>
                                                <div className="space-y-1">
                                                    {count.items?.map((item) => (
                                                        <div key={item.id} className="flex items-center justify-between p-2 bg-tertiary rounded text-sm">
                                                            <span>{item.product_name}</span>
                                                            <div className="flex items-center gap-4">
                                                                <span>Attendu: {item.expected_quantity}</span>
                                                                <span>Compté: {item.counted_quantity}</span>
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
                                                    onClick={() => validateCount.mutate(count.id)}
                                                    className="btn-success flex items-center gap-1 mt-3"
                                                >
                                                    <Check size={16} /> Valider et ajuster le stock
                                                </button>
                                            </div>
                                        )}

                                        {/* Validated */}
                                        {count.status === 'VALIDATED' && (
                                            <p className="text-success text-sm">✓ Inventaire validé - Stock ajusté</p>
                                        )}
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
