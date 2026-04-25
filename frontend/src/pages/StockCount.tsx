import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
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

export default function StockCount() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [showForm, setShowForm] = useState(false);
    const [expandedCount, setExpandedCount] = useState<number | null>(null);
    const [countName, setCountName] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
    const [searchProduct, setSearchProduct] = useState('');
    const [countedValues, setCountedValues] = useState<Record<number, number>>({});
    const [countMode, setCountMode] = useState<'total' | 'add'>('total');
    const [createQuantities, setCreateQuantities] = useState<Record<number, number>>({}); // Quantités lors de création

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
        onError: (error: unknown) => {
            console.error('Create count error:', error);
            const msg = getApiErrorMessage(error, 'Erreur lors de la creation');
            toast.error('Erreur: ' + msg);
        }
    });

    // Update count (save counted values) - FIX: Use POST on /update_counts/ endpoint
    const updateCount = useMutation({
        mutationFn: ({ id, items }: { id: number; items: { id: number; counted_quantity: number }[] }) =>
            client.post(`/inventory/counts/${id}/update_counts/`, { items }),
        onSuccess: () => {
            toast.success('Comptage sauvegardé');
            queryClient.invalidateQueries({ queryKey: ['inventoryCounts'] });
        },
        onError: (error: unknown) => {
            const msg = getApiErrorMessage(error, 'Erreur lors de la sauvegarde');
            toast.error(msg);
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
        setCreateQuantities({});
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

        // Vérifier qu'au moins une quantité est saisie
        const hasQuantities = selectedProducts.some(p => createQuantities[p.id] !== undefined);
        if (!hasQuantities) {
            toast.error('Entrez au moins une quantité');
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
                        <div className="mb-4">
                            {/* Mode selector */}
                            <div className="flex items-center gap-4 mb-4 p-3 bg-accent-light/20 rounded-lg">
                                <span className="text-sm font-medium">Mode :</span>
                                <div className="flex bg-tertiary rounded-lg p-1">
                                    <button
                                        type="button"
                                        onClick={() => setCountMode('total')}
                                        className={`px-3 py-1 rounded text-sm transition ${countMode === 'total' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                    >
                                        Quantité totale comptée
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCountMode('add')}
                                        className={`px-3 py-1 rounded text-sm transition ${countMode === 'add' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                    >
                                        Quantité à ajouter
                                    </button>
                                </div>
                            </div>
                            <p className="text-sm font-medium mb-2">
                                {selectedProducts.length} produit(s) - {countMode === 'total' ? 'Entrez le stock TOTAL' : 'Entrez la quantité à AJOUTER'}
                            </p>
                            <div className="space-y-2 max-h-64 overflow-auto">
                                {selectedProducts.map(p => (
                                    <div key={p.id} className="flex items-center gap-4 p-3 bg-tertiary rounded">
                                        <span className="flex-1 font-medium">{p.name}</span>
                                        <span className="text-sm text-muted">Stock actuel: {p.stock}</span>
                                        <input
                                            type="number"
                                            min={0}
                                            placeholder={countMode === 'total' ? 'Total' : 'À ajouter'}
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
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
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
                                                {new Date(count.created_at).toLocaleDateString('fr-FR')} • {count.items?.length || 0} produit(s)
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
                                                <span className="text-muted text-xs">+{count.items.length - 3} autres</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted mt-1">Cliquez pour voir tous les détails</p>
                                    </div>
                                )}

                                {expandedCount === count.id && (
                                    <div className="mt-4 pl-14 space-y-3">
                                        {/* Items to count */}
                                        {count.status === 'IN_PROGRESS' && (
                                            <div className="space-y-2">
                                                {/* Mode selector */}
                                                <div className="flex items-center gap-4 mb-4 p-3 bg-accent-light/20 rounded-lg">
                                                    <span className="text-sm font-medium">Mode de saisie :</span>
                                                    <div className="flex bg-tertiary rounded-lg p-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCountMode('total')}
                                                            className={`px-3 py-1 rounded text-sm transition ${countMode === 'total' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                                        >
                                                            Quantité totale
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCountMode('add')}
                                                            className={`px-3 py-1 rounded text-sm transition ${countMode === 'add' ? 'bg-accent text-white' : 'hover:bg-hover'}`}
                                                        >
                                                            Ajouter au stock
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-sm font-medium">
                                                    {countMode === 'total'
                                                        ? 'Saisissez le stock TOTAL compté :'
                                                        : 'Saisissez la quantité à AJOUTER :'}
                                                </p>
                                                {count.items?.map((item) => (
                                                    <div key={item.id} className="flex items-center gap-4 p-2 bg-tertiary rounded">
                                                        <span className="flex-1">{item.product_name || `Produit #${item.product}`}</span>
                                                        <span className="text-sm text-muted">Stock actuel: {item.expected_quantity}</span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            placeholder={countMode === 'total' ? 'Total compté' : 'À ajouter'}
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
                                                            <div className="flex flex-col">
                                                                <span>{item.product_name}</span>
                                                                <span className="text-xs text-muted">{item.product_barcode}</span>
                                                            </div>
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

                                        {/* Validated - show summary with details */}
                                        {count.status === 'VALIDATED' && (
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-2 text-success">
                                                    <Check size={18} />
                                                    <span className="font-medium">Inventaire validé - Stock ajusté</span>
                                                </div>
                                                <div className="border border-success/30 rounded-lg overflow-hidden">
                                                    <div className="bg-success/10 px-3 py-2 text-sm font-medium border-b border-success/30">
                                                        Résumé des ajustements ({count.items?.length || 0} produit(s))
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
                                                                        <span className="text-muted text-xs block">Avant</span>
                                                                        <span>{item.expected_quantity}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="text-muted text-xs block">Après</span>
                                                                        <span className="font-bold">{item.counted_quantity}</span>
                                                                    </div>
                                                                    <div className="w-16">
                                                                        <span className="text-muted text-xs block">Écart</span>
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
                                                        Validé le {new Date(count.completed_at).toLocaleDateString('fr-FR')} à {new Date(count.completed_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
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
            </div>
        </div>
    );
}
