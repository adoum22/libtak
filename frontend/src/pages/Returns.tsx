import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client from '../api/client';
import { useToast } from '../components/Toast';
import {
    RotateCcw,
    Search,
    Check,
    X,
    ChevronDown,
    ChevronUp,
    Calendar
} from 'lucide-react';

interface Sale {
    id: number;
    total_ttc: number;
    payment_method: string;
    created_at: string;
    items: SaleItem[];
    user_name?: string;
}

interface SaleItem {
    id: number;
    product_name: string;
    quantity: number;
    unit_price_ht: number;
    tva_rate: number;
}

interface Return {
    id: number;
    sale: number;
    sale_total: number;
    status: string;
    status_display: string;
    reason: string;
    refund_amount: number;
    items: ReturnItem[];
    processed_by_name: string;
    created_at: string;
}

interface ReturnItem {
    id: number;
    sale_item: number;
    quantity: number;
    product_name: string;
    unit_price: number;
}

export default function Returns() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
    const [returnItems, setReturnItems] = useState<{ saleItemId: number; quantity: number }[]>([]);
    const [reason, setReason] = useState('');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [expandedReturn, setExpandedReturn] = useState<number | null>(null);

    // Fetch returns list
    const { data: returns = [], isLoading: loadingReturns } = useQuery<Return[]>({
        queryKey: ['returns'],
        queryFn: () => client.get('/sales/returns/').then(res => {
            const data = res.data;
            return Array.isArray(data) ? data : (data.results || []);
        })
    });

    // Fetch recent sales for easy selection
    const { data: recentSales = [] } = useQuery<Sale[]>({
        queryKey: ['recentSales'],
        queryFn: () => client.get('/sales/sales/?limit=20').then(res => {
            const data = res.data;
            return Array.isArray(data) ? data : (data.results || []);
        }),
        enabled: showCreateForm
    });

    // Search filtered sales
    const filteredSales = recentSales.filter(sale => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            sale.id.toString().includes(term) ||
            sale.items?.some(item => item.product_name.toLowerCase().includes(term))
        );
    });

    // Select a sale
    const selectSale = (sale: Sale) => {
        setSelectedSale(sale);
        setReturnItems([]);
        setSearchTerm('');
    };

    // Create return mutation
    const createReturn = useMutation({
        mutationFn: (data: { sale: number; reason: string; items: { sale_item: number; quantity: number }[] }) =>
            client.post('/sales/returns/', data),
        onSuccess: () => {
            toast.success('Retour créé avec succès - Stock mis à jour');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['recentSales'] });
            resetForm();
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.detail || 'Erreur lors de la création du retour');
        }
    });

    // Approve return
    const approveReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/approve/`),
        onSuccess: () => {
            toast.success('Retour approuvé');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        }
    });

    // Reject return
    const rejectReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/reject/`),
        onSuccess: () => {
            toast.success('Retour rejeté');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        }
    });

    // Complete return
    const completeReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/complete/`),
        onSuccess: () => {
            toast.success('Retour terminé');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        }
    });

    const resetForm = () => {
        setSelectedSale(null);
        setReturnItems([]);
        setReason('');
        setSearchTerm('');
        setShowCreateForm(false);
    };

    const toggleItem = (saleItemId: number, maxQty: number) => {
        const existing = returnItems.find(i => i.saleItemId === saleItemId);
        if (existing) {
            setReturnItems(returnItems.filter(i => i.saleItemId !== saleItemId));
        } else {
            setReturnItems([...returnItems, { saleItemId, quantity: maxQty }]);
        }
    };

    const updateItemQty = (saleItemId: number, qty: number, maxQty: number) => {
        setReturnItems(returnItems.map(i =>
            i.saleItemId === saleItemId
                ? { ...i, quantity: Math.max(1, Math.min(qty, maxQty)) }
                : i
        ));
    };

    const handleSubmitReturn = () => {
        if (!selectedSale || returnItems.length === 0 || !reason.trim()) {
            toast.error('Veuillez sélectionner des articles et indiquer une raison');
            return;
        }
        createReturn.mutate({
            sale: selectedSale.id,
            reason,
            items: returnItems.map(i => ({ sale_item: i.saleItemId, quantity: i.quantity }))
        });
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            PENDING: 'badge-warning',
            APPROVED: 'badge-info',
            REJECTED: 'badge-danger',
            COMPLETED: 'badge-success'
        };
        return styles[status] || 'badge-secondary';
    };

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <RotateCcw className="text-accent" />
                        Gestion des Retours
                    </h1>
                    <p className="text-muted mt-1">Gérez les retours produits et remboursements</p>
                </div>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="btn-primary flex items-center gap-2"
                >
                    <RotateCcw size={18} />
                    Nouveau Retour
                </button>
            </div>

            {/* Create Return Form */}
            {showCreateForm && (
                <div className="card p-6 border-accent border-2">
                    <h2 className="text-xl font-bold mb-4">Créer un Retour</h2>

                    {!selectedSale ? (
                        <>
                            {/* Search & Select Sale */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium mb-2">
                                    Rechercher une vente (par ID ou produit)
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                    <input
                                        type="text"
                                        placeholder="N° de vente ou nom du produit..."
                                        className="input pl-10 w-full"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Sales List */}
                            <div className="space-y-2 max-h-64 overflow-auto">
                                <p className="text-sm text-muted mb-2">
                                    {searchTerm ? `Résultats pour "${searchTerm}"` : 'Ventes récentes'}
                                </p>
                                {filteredSales.length === 0 ? (
                                    <p className="text-center text-muted py-4">Aucune vente trouvée</p>
                                ) : (
                                    filteredSales.map(sale => (
                                        <div
                                            key={sale.id}
                                            onClick={() => selectSale(sale)}
                                            className="p-3 border rounded-lg hover:border-accent hover:bg-accent-light cursor-pointer transition-all"
                                        >
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <span className="font-bold">Vente #{sale.id}</span>
                                                    <div className="text-xs text-muted flex items-center gap-2 mt-1">
                                                        <Calendar size={12} />
                                                        {new Date(sale.created_at).toLocaleString('fr-FR')}
                                                    </div>
                                                </div>
                                                <span className="font-bold text-accent">{sale.total_ttc.toFixed(2)} DH</span>
                                            </div>
                                            <div className="mt-2 text-sm text-muted">
                                                {sale.items?.slice(0, 3).map(item => item.product_name).join(', ')}
                                                {sale.items?.length > 3 && ` +${sale.items.length - 3} autres`}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Selected Sale */}
                            <div className="space-y-4">
                                <div className="p-4 bg-tertiary rounded-lg flex justify-between items-center">
                                    <div>
                                        <span className="font-bold">Vente #{selectedSale.id}</span>
                                        <p className="text-sm text-muted">
                                            {new Date(selectedSale.created_at).toLocaleString('fr-FR')}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-accent font-bold">{selectedSale.total_ttc.toFixed(2)} DH</span>
                                        <button
                                            onClick={() => setSelectedSale(null)}
                                            className="btn-ghost text-sm"
                                        >
                                            Changer
                                        </button>
                                    </div>
                                </div>

                                {/* Items Selection */}
                                <div>
                                    <h3 className="font-medium mb-2">Sélectionnez les articles à retourner :</h3>
                                    <div className="space-y-2">
                                        {selectedSale.items?.map((item) => {
                                            const selected = returnItems.find(i => i.saleItemId === item.id);
                                            return (
                                                <div
                                                    key={item.id}
                                                    className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${selected ? 'border-accent bg-accent-light' : 'border-border hover:border-accent/50'}`}
                                                    onClick={() => toggleItem(item.id, item.quantity)}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selected ? 'bg-accent border-accent' : 'border-muted'}`}>
                                                                {selected && <Check size={14} className="text-white" />}
                                                            </div>
                                                            <span className="font-medium">{item.product_name}</span>
                                                        </div>
                                                        <span className="text-sm text-muted">Qté vendue: {item.quantity}</span>
                                                    </div>
                                                    {selected && (
                                                        <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                            <span className="text-sm">Quantité à retourner:</span>
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                max={item.quantity}
                                                                value={selected.quantity}
                                                                onChange={(e) => updateItemQty(item.id, parseInt(e.target.value), item.quantity)}
                                                                className="input w-20 text-center"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Reason */}
                                <div>
                                    <label className="block text-sm font-medium mb-2">Raison du retour *</label>
                                    <textarea
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder="Produit défectueux, erreur de commande..."
                                        className="input w-full h-24 resize-none"
                                    />
                                </div>

                                {/* Info */}
                                <div className="p-3 bg-info-light rounded-lg border border-info/20 text-sm">
                                    <strong>Note:</strong> Le stock sera automatiquement mis à jour après la création du retour.
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleSubmitReturn}
                                        disabled={returnItems.length === 0 || !reason.trim() || createReturn.isPending}
                                        className="btn-primary flex-1"
                                    >
                                        {createReturn.isPending ? 'Création...' : 'Créer le Retour'}
                                    </button>
                                    <button onClick={resetForm} className="btn-secondary">
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Returns List */}
            <div className="card">
                <div className="card-header">
                    <h2 className="font-semibold">Historique des Retours</h2>
                </div>
                <div className="divide-y">
                    {loadingReturns ? (
                        <div className="p-8 text-center text-muted">Chargement...</div>
                    ) : returns.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <RotateCcw size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Aucun retour enregistré</p>
                        </div>
                    ) : (
                        returns.map((ret) => (
                            <div key={ret.id} className="p-4">
                                <div
                                    className="flex items-center justify-between cursor-pointer"
                                    onClick={() => setExpandedReturn(expandedReturn === ret.id ? null : ret.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-tertiary rounded-full flex items-center justify-center">
                                            <RotateCcw size={20} className="text-muted" />
                                        </div>
                                        <div>
                                            <p className="font-medium">Retour #{ret.id} - Vente #{ret.sale}</p>
                                            <p className="text-sm text-muted">
                                                {new Date(ret.created_at).toLocaleString('fr-FR')}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`badge ${getStatusBadge(ret.status)}`}>
                                            {ret.status_display || ret.status}
                                        </span>
                                        <span className="font-bold text-lg">{ret.refund_amount?.toFixed(2) || '0.00'} DH</span>
                                        {expandedReturn === ret.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                    </div>
                                </div>

                                {/* Expanded Details */}
                                {expandedReturn === ret.id && (
                                    <div className="mt-4 pl-14 space-y-3">
                                        <div className="p-3 bg-tertiary/50 rounded-lg">
                                            <p className="text-sm font-medium mb-1">Raison:</p>
                                            <p className="text-muted">{ret.reason}</p>
                                        </div>

                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">Articles retournés:</p>
                                            {ret.items?.map((item) => (
                                                <div key={item.id} className="flex justify-between text-sm">
                                                    <span>{item.quantity}x {item.product_name}</span>
                                                    <span className="text-muted">{item.unit_price?.toFixed(2)} DH/u</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Action Buttons */}
                                        {ret.status === 'PENDING' && (
                                            <div className="flex gap-2 pt-2">
                                                <button
                                                    onClick={() => approveReturn.mutate(ret.id)}
                                                    disabled={approveReturn.isPending}
                                                    className="btn-success flex items-center gap-1 text-sm"
                                                >
                                                    <Check size={16} /> Approuver
                                                </button>
                                                <button
                                                    onClick={() => rejectReturn.mutate(ret.id)}
                                                    disabled={rejectReturn.isPending}
                                                    className="btn-danger flex items-center gap-1 text-sm"
                                                >
                                                    <X size={16} /> Rejeter
                                                </button>
                                            </div>
                                        )}
                                        {ret.status === 'APPROVED' && (
                                            <button
                                                onClick={() => completeReturn.mutate(ret.id)}
                                                disabled={completeReturn.isPending}
                                                className="btn-primary flex items-center gap-1 text-sm"
                                            >
                                                <Check size={16} /> Marquer Terminé
                                            </button>
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
