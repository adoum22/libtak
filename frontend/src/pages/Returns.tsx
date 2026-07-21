import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import Pagination from '../components/Pagination';
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
    returnable_quantity: number;
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
    refund_method: PaymentMethod;
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
    restock: boolean;
}

type PaymentMethod = 'CASH' | 'CARD' | 'OTHER';

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
    CASH: 'Espèces',
    CARD: 'Carte',
    OTHER: 'Autre',
};

interface ReturnsPage {
    count: number;
    results: Return[];
}

const PAGE_SIZE = 50;

export default function Returns() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
    const [returnItems, setReturnItems] = useState<{ saleItemId: number; quantity: number; restock: boolean }[]>([]);
    const [reason, setReason] = useState('');
    const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [expandedReturn, setExpandedReturn] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [idempotencyKey, setIdempotencyKey] = useState(() => globalThis.crypto.randomUUID());

    // Fetch returns list
    const { data: returnsPage, isLoading: loadingReturns, isError: returnsError, refetch: refetchReturns } = useQuery<ReturnsPage>({
        queryKey: ['returns', page],
        queryFn: () => client.get('/sales/returns/', { params: { page } }).then(res => ({
            count: Number(res.data?.count ?? (Array.isArray(res.data) ? res.data.length : 0)),
            results: res.data?.results ?? (Array.isArray(res.data) ? res.data : []),
        })),
        placeholderData: previous => previous,
    });
    const returns = returnsPage?.results ?? [];
    const returnsCount = returnsPage?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(returnsCount / PAGE_SIZE));

    // Fetch recent sales for easy selection
    const { data: recentSales = [], isLoading: salesLoading, isError: salesError, refetch: refetchSales } = useQuery<Sale[]>({
        queryKey: ['recentSales', searchTerm],
        queryFn: () => client.get('/sales/sales/', { params: { search: searchTerm.trim() || undefined } }).then(res => {
            const data = res.data;
            return Array.isArray(data) ? data : (data.results || []);
        }),
        enabled: showCreateForm
    });

    const filteredSales = recentSales;

    // Select a sale
    const selectSale = (sale: Sale) => {
        setSelectedSale(sale);
        setReturnItems([]);
        setRefundMethod(
            sale.payment_method === 'CARD' || sale.payment_method === 'OTHER'
                ? sale.payment_method
                : 'CASH'
        );
        setSearchTerm('');
        setIdempotencyKey(globalThis.crypto.randomUUID());
    };

    // Create return mutation
    const createReturn = useMutation({
        mutationFn: (data: { sale: number; reason: string; refund_method: PaymentMethod; items: { sale_item: number; quantity: number; restock: boolean }[]; idempotency_key: string }) =>
            client.post('/sales/returns/', data),
        onSuccess: () => {
            toast.success("Demande de retour créée. Le stock sera modifié après l'approbation.");
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['recentSales'] });
            setIdempotencyKey(globalThis.crypto.randomUUID());
            resetForm();
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, 'Erreur lors de la creation du retour'));
        }
    });

    // Approve return
    const approveReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/approve/`),
        onSuccess: () => {
            toast.success('Retour approuvé');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['stock'] });
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, "L'approbation du retour a échoué"));
        },
    });

    // Reject return
    const rejectReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/reject/`),
        onSuccess: () => {
            toast.success('Retour rejeté');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, 'Le rejet du retour a échoué'));
        },
    });

    // Complete return
    const completeReturn = useMutation({
        mutationFn: (id: number) => client.post(`/sales/returns/${id}/complete/`),
        onSuccess: () => {
            toast.success('Retour terminé');
            queryClient.invalidateQueries({ queryKey: ['returns'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, 'Le remboursement du retour a échoué'));
        },
    });

    const resetForm = () => {
        setSelectedSale(null);
        setReturnItems([]);
        setReason('');
        setRefundMethod('CASH');
        setSearchTerm('');
        setShowCreateForm(false);
        setIdempotencyKey(globalThis.crypto.randomUUID());
    };

    const toggleItem = (saleItemId: number, maxQty: number) => {
        const existing = returnItems.find(i => i.saleItemId === saleItemId);
        if (existing) {
            setReturnItems(returnItems.filter(i => i.saleItemId !== saleItemId));
        } else {
            setReturnItems([...returnItems, { saleItemId, quantity: maxQty, restock: true }]);
        }
        setIdempotencyKey(globalThis.crypto.randomUUID());
    };

    const updateItemQty = (saleItemId: number, qty: number, maxQty: number) => {
        const safeQty = Number.isFinite(qty) ? Math.max(1, Math.min(qty, maxQty)) : 1;
        setReturnItems(returnItems.map(i =>
            i.saleItemId === saleItemId
                ? { ...i, quantity: safeQty }
                : i
        ));
        setIdempotencyKey(globalThis.crypto.randomUUID());
    };

    const updateItemRestock = (saleItemId: number, restock: boolean) => {
        setReturnItems(returnItems.map(i =>
            i.saleItemId === saleItemId ? { ...i, restock } : i
        ));
        setIdempotencyKey(globalThis.crypto.randomUUID());
    };

    const handleSubmitReturn = () => {
        if (!selectedSale || returnItems.length === 0 || !reason.trim()) {
            toast.error('Veuillez sélectionner des articles et indiquer une raison');
            return;
        }
        createReturn.mutate({
            sale: selectedSale.id,
            reason,
            refund_method: refundMethod,
            items: returnItems.map(i => ({
                sale_item: i.saleItemId,
                quantity: i.quantity,
                restock: i.restock,
            })),
            idempotency_key: idempotencyKey,
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
                    type="button"
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="btn-primary flex items-center gap-2"
                    aria-expanded={showCreateForm}
                    aria-controls="return-create-form"
                >
                    <RotateCcw size={18} />
                    Nouveau Retour
                </button>
            </div>

            {/* Create Return Form */}
            {showCreateForm && (
                <div id="return-create-form" className="card p-6 border-accent border-2">
                    <h2 className="text-xl font-bold mb-4">Créer un Retour</h2>

                    {!selectedSale ? (
                        <>
                            {/* Search & Select Sale */}
                            <div className="mb-4">
                                <label htmlFor="return-sale-search" className="block text-sm font-medium mb-2">
                                    Rechercher une vente (par ID ou produit)
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                    <input
                                        id="return-sale-search"
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
                                {salesLoading ? (
                                    <p className="text-center text-muted py-4" role="status">Chargement…</p>
                                ) : salesError ? (
                                    <div className="network-error-state" role="alert"><p>Les ventes ne peuvent pas être recherchées.</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchSales()}>Réessayer</button></div>
                                ) : filteredSales.length === 0 ? (
                                    <p className="text-center text-muted py-4">Aucune vente trouvée</p>
                                ) : (
                                    filteredSales.map(sale => (
                                        <button
                                            type="button"
                                            key={sale.id}
                                            onClick={() => selectSale(sale)}
                                            className="w-full p-3 border rounded-lg hover:border-accent hover:bg-accent-light transition-all text-left"
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
                                        </button>
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
                                            type="button"
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
                                            const returnableQuantity = Math.max(
                                                0,
                                                Number(item.returnable_quantity ?? item.quantity),
                                            );
                                            return (
                                                <div
                                                    key={item.id}
                                                    className={`p-3 rounded-lg border-2 transition-all ${selected ? 'border-accent bg-accent-light' : 'border-border hover:border-accent/50'}`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(selected)}
                                                                disabled={returnableQuantity === 0}
                                                                onChange={() => toggleItem(item.id, returnableQuantity)}
                                                                aria-label={`Retourner ${item.product_name}`}
                                                            />
                                                            <span className="font-medium">{item.product_name}</span>
                                                        </div>
                                                        <span className="text-sm text-muted">
                                                            Vendue : {item.quantity} · encore retournable : {returnableQuantity}
                                                        </span>
                                                    </div>
                                                    {selected && (
                                                        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <label htmlFor={`return-quantity-${item.id}`} className="text-sm">Quantité à retourner :</label>
                                                                <input
                                                                    id={`return-quantity-${item.id}`}
                                                                    type="number"
                                                                    min={1}
                                                                    max={returnableQuantity}
                                                                    value={selected.quantity}
                                                                    onChange={(e) => updateItemQty(item.id, parseInt(e.target.value), returnableQuantity)}
                                                                    className="input w-20 text-center"
                                                                />
                                                            </div>
                                                            <label className="flex items-center gap-2 text-sm" htmlFor={`return-restock-${item.id}`}>
                                                                <input
                                                                    id={`return-restock-${item.id}`}
                                                                    type="checkbox"
                                                                    checked={selected.restock}
                                                                    onChange={(e) => updateItemRestock(item.id, e.target.checked)}
                                                                />
                                                                Remettre dans le stock vendable
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Refund method */}
                                <div>
                                    <label htmlFor="return-refund-method" className="block text-sm font-medium mb-2">
                                        Mode de remboursement
                                    </label>
                                    <select
                                        id="return-refund-method"
                                        value={refundMethod}
                                        onChange={(e) => {
                                            setRefundMethod(e.target.value as PaymentMethod);
                                            setIdempotencyKey(globalThis.crypto.randomUUID());
                                        }}
                                        className="input w-full"
                                    >
                                        {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                    <p className="mt-1 text-xs text-muted">
                                        Par défaut, le mode de paiement de la vente est repris.
                                    </p>
                                </div>

                                {/* Reason */}
                                <div>
                                    <label htmlFor="return-reason" className="block text-sm font-medium mb-2">Raison du retour *</label>
                                    <textarea
                                        id="return-reason"
                                        value={reason}
                                        onChange={(e) => { setReason(e.target.value); setIdempotencyKey(globalThis.crypto.randomUUID()); }}
                                        placeholder="Produit défectueux, erreur de commande..."
                                        className="input w-full h-24 resize-none"
                                    />
                                </div>

                                {/* Info */}
                                <div className="p-3 bg-info-light rounded-lg border border-info/20 text-sm">
                                    <strong>Note :</strong> la création enregistre une demande en attente. Le stock des articles
                                    cochés « vendables » ne sera remis à jour qu'après approbation. Décochez cette option pour
                                    un article endommagé ou invendable.
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={handleSubmitReturn}
                                        disabled={returnItems.length === 0 || !reason.trim() || createReturn.isPending}
                                        className="btn-primary flex-1"
                                    >
                                        {createReturn.isPending ? 'Création...' : 'Créer le Retour'}
                                    </button>
                                    <button type="button" onClick={resetForm} className="btn-secondary">
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
                        <div className="p-8 text-center text-muted" role="status">Chargement…</div>
                    ) : returnsError ? (
                        <div className="network-error-state m-4" role="alert"><p>Les retours n’ont pas pu être chargés.</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetchReturns()}>Réessayer</button></div>
                    ) : returns.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <RotateCcw size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Aucun retour enregistré</p>
                        </div>
                    ) : (
                        returns.map((ret) => (
                            <div key={ret.id} className="p-4">
                                <button
                                    type="button"
                                    className="w-full flex items-center justify-between text-left bg-transparent p-0"
                                    onClick={() => setExpandedReturn(expandedReturn === ret.id ? null : ret.id)}
                                    aria-expanded={expandedReturn === ret.id}
                                    aria-controls={`return-details-${ret.id}`}
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
                                </button>

                                {/* Expanded Details */}
                                {expandedReturn === ret.id && (
                                    <div id={`return-details-${ret.id}`} className="mt-4 pl-14 space-y-3">
                                        <div className="p-3 bg-tertiary/50 rounded-lg">
                                            <p className="text-sm font-medium mb-1">Raison:</p>
                                            <p className="text-muted">{ret.reason}</p>
                                            <p className="text-sm text-muted mt-2">
                                                Remboursement : {PAYMENT_METHOD_LABELS[ret.refund_method] ?? ret.refund_method}
                                            </p>
                                        </div>

                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">Articles retournés:</p>
                                            {ret.items?.map((item) => (
                                                <div key={item.id} className="flex justify-between text-sm">
                                                    <span>
                                                        {item.quantity}x {item.product_name}
                                                        {' · '}{item.restock ? 'retour au stock' : 'hors stock (endommagé/invendable)'}
                                                    </span>
                                                    <span className="text-muted">{item.unit_price?.toFixed(2)} DH/u</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Action Buttons */}
                                        {ret.status === 'PENDING' && (
                                            <div className="flex gap-2 pt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (globalThis.confirm("Approuver ce retour et appliquer les mouvements de stock indiqués ?")) {
                                                            approveReturn.mutate(ret.id);
                                                        }
                                                    }}
                                                    disabled={approveReturn.isPending}
                                                    className="btn-success flex items-center gap-1 text-sm"
                                                >
                                                    <Check size={16} /> Approuver
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (globalThis.confirm('Rejeter définitivement cette demande de retour ?')) {
                                                            rejectReturn.mutate(ret.id);
                                                        }
                                                    }}
                                                    disabled={rejectReturn.isPending}
                                                    className="btn-danger flex items-center gap-1 text-sm"
                                                >
                                                    <X size={16} /> Rejeter
                                                </button>
                                            </div>
                                        )}
                                        {ret.status === 'APPROVED' && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (globalThis.confirm('Confirmer que le remboursement a réellement été effectué ?')) {
                                                        completeReturn.mutate(ret.id);
                                                    }
                                                }}
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
                {!loadingReturns && !returnsError && (
                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        totalItems={returnsCount}
                        pageSize={PAGE_SIZE}
                        onPageChange={nextPage => { setExpandedReturn(null); setPage(nextPage); }}
                    />
                )}
            </div>
        </div>
    );
}
