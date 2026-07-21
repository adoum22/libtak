import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';
import {
    CreditCard,
    Search,
    User,
    X,
    Check,
    Phone,
    Receipt,
    Banknote,
} from 'lucide-react';

interface CreditPayment {
    id: number;
    amount: number;
    note: string;
    created_by_name?: string;
    created_at: string;
}

interface SaleItem {
    id: number;
    product_name: string;
    quantity: number;
    unit_price_ht: number;
}

interface CreditSale {
    id: number;
    sale: number;
    sale_date: string;
    sale_total: number;
    sale_discount?: number;
    customer: number;
    customer_name: string;
    customer_phone?: string;
    status: 'UNPAID' | 'PARTIAL' | 'PAID';
    status_display: string;
    paid_amount: number;
    remaining_amount: number;
    created_at: string;
    items?: SaleItem[];
    payments?: CreditPayment[];
}

type StatusFilter = 'ALL' | 'OPEN' | 'UNPAID' | 'PARTIAL' | 'PAID';

const statusBadge = (status: CreditSale['status']) => {
    if (status === 'PAID') return 'badge-success';
    if (status === 'PARTIAL') return 'badge-warning';
    return 'badge-danger';
};

const formatDate = (iso: string) => {
    try {
        return new Date(iso).toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
};

export default function Credit() {
    const queryClient = useQueryClient();
    const toast = useToast();

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [paymentInput, setPaymentInput] = useState('');
    const [paymentNote, setPaymentNote] = useState('');

    // Debounce de la recherche pour éviter une requête par caractère
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 250);
        return () => clearTimeout(t);
    }, [search]);

    const selectCredit = (creditId: number) => {
        setPaymentInput('');
        setPaymentNote('');
        setSelectedId(creditId);
    };

    const closeCredit = () => {
        setPaymentInput('');
        setPaymentNote('');
        setSelectedId(null);
    };

    const { data: credits = [], isLoading } = useQuery<CreditSale[]>({
        queryKey: ['credits', statusFilter, debouncedSearch],
        queryFn: () => {
            const params = new URLSearchParams();
            if (debouncedSearch) params.set('search', debouncedSearch);
            if (statusFilter === 'UNPAID' || statusFilter === 'PARTIAL' || statusFilter === 'PAID') {
                params.set('status', statusFilter);
            }
            return client.get(`/credit/credits/?${params.toString()}`).then(res => {
                const data = res.data;
                return Array.isArray(data) ? data : (data.results || []);
            });
        },
    });

    const filteredCredits = credits.filter(c => {
        if (statusFilter === 'OPEN') return c.status !== 'PAID';
        return true;
    });

    const { data: detail } = useQuery<CreditSale>({
        queryKey: ['credit-detail', selectedId],
        queryFn: () => client.get(`/credit/credits/${selectedId}/`).then(res => res.data),
        enabled: !!selectedId,
    });

    const payMutation = useMutation({
        mutationFn: (data: { amount: number; note: string }) =>
            client.post(`/credit/credits/${selectedId}/pay/`, data).then(res => res.data),
        onSuccess: () => {
            toast.success('Règlement enregistré.');
            setPaymentInput('');
            setPaymentNote('');
            queryClient.invalidateQueries({ queryKey: ['credits'] });
            queryClient.invalidateQueries({ queryKey: ['credit-detail', selectedId] });
            queryClient.invalidateQueries({ queryKey: ['cashRegister'] });
            queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
            queryClient.invalidateQueries({ queryKey: ['acc-period'] });
            queryClient.invalidateQueries({ queryKey: ['acc-month'] });
            queryClient.invalidateQueries({ queryKey: ['acc-summary'] });
        },
        onError: (error: unknown) => {
            toast.error("Erreur règlement : " + getApiErrorMessage(error));
        },
    });

    const submitPayment = () => {
        if (!detail) return;
        const remaining = Number(detail.remaining_amount) || 0;
        let amount = parseDecimalInput(paymentInput) || 0;
        if (amount <= 0) {
            toast.error('Montant invalide.');
            return;
        }
        // Si l'utilisateur a tapé exactement le restant arrondi à 2 décimales,
        // on envoie la valeur exacte du backend pour éviter un reliquat de 0.001 DH
        // qui empêcherait le crédit de passer en PAID.
        if (Math.abs(amount - Number(remaining.toFixed(2))) < 0.005) {
            amount = remaining;
        }
        if (amount > remaining + 0.01) {
            toast.error('Le règlement dépasse le restant dû.');
            return;
        }
        payMutation.mutate({ amount, note: paymentNote });
    };

    const payFullBalance = () => {
        if (!detail) return;
        payMutation.mutate({
            amount: Number(detail.remaining_amount) || 0,
            note: paymentNote,
        });
    };

    const totals = filteredCredits.reduce(
        (acc, c) => {
            acc.total += Number(c.sale_total) || 0;
            acc.paid += Number(c.paid_amount) || 0;
            acc.remaining += Number(c.remaining_amount) || 0;
            return acc;
        },
        { total: 0, paid: 0, remaining: 0 },
    );

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-warning text-white flex items-center justify-center">
                        <CreditCard size={22} />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold">Crédits clients</h1>
                        <p className="text-muted text-sm">Ventes à crédit et règlements</p>
                    </div>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold">Total crédité</p>
                    <p className="text-2xl font-bold mt-1">{totals.total.toFixed(2)} DH</p>
                </div>
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold">Déjà réglé</p>
                    <p className="text-2xl font-bold mt-1 text-success">{totals.paid.toFixed(2)} DH</p>
                </div>
                <div className="card p-4">
                    <p className="text-xs uppercase text-muted font-semibold">Restant dû</p>
                    <p className="text-2xl font-bold mt-1 text-danger">{totals.remaining.toFixed(2)} DH</p>
                </div>
            </div>

            {/* Filters */}
            <div className="card p-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                    <input
                        type="text"
                        placeholder="Rechercher un client..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="input w-full pl-10"
                    />
                </div>
                <div className="flex gap-1 bg-tertiary/40 p-1 rounded-lg">
                    {([
                        { key: 'OPEN', label: 'Ouverts' },
                        { key: 'UNPAID', label: 'Non réglés' },
                        { key: 'PARTIAL', label: 'Partiels' },
                        { key: 'PAID', label: 'Réglés' },
                        { key: 'ALL', label: 'Tous' },
                    ] as const).map(opt => (
                        <button
                            key={opt.key}
                            onClick={() => setStatusFilter(opt.key)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${statusFilter === opt.key ? 'bg-secondary shadow text-accent' : 'text-muted hover:text-primary'}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Credits list */}
            <div className="card overflow-hidden">
                {isLoading ? (
                    <p className="p-6 text-muted text-center">Chargement...</p>
                ) : filteredCredits.length === 0 ? (
                    <p className="p-6 text-muted text-center">Aucun crédit pour ces filtres.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-tertiary/40 text-muted text-xs uppercase">
                                <tr>
                                    <th className="p-3 text-left">Date</th>
                                    <th className="p-3 text-left">Client</th>
                                    <th className="p-3 text-right">Total</th>
                                    <th className="p-3 text-right">Payé</th>
                                    <th className="p-3 text-right">Restant</th>
                                    <th className="p-3 text-left">Statut</th>
                                    <th className="p-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCredits.map(c => (
                                    <tr
                                        key={c.id}
                                        className="border-t border-border hover:bg-tertiary/30 cursor-pointer"
                                        onClick={() => selectCredit(c.id)}
                                    >
                                        <td className="p-3 whitespace-nowrap text-muted">{formatDate(c.sale_date)}</td>
                                        <td className="p-3">
                                            <div className="font-medium">{c.customer_name}</div>
                                            {c.customer_phone && (
                                                <div className="text-xs text-muted flex items-center gap-1">
                                                    <Phone size={11} /> {c.customer_phone}
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-3 text-right whitespace-nowrap font-mono">{Number(c.sale_total).toFixed(2)} DH</td>
                                        <td className="p-3 text-right whitespace-nowrap font-mono text-success">{Number(c.paid_amount).toFixed(2)} DH</td>
                                        <td className="p-3 text-right whitespace-nowrap font-mono text-danger">{Number(c.remaining_amount).toFixed(2)} DH</td>
                                        <td className="p-3">
                                            <span className={`badge ${statusBadge(c.status)}`}>{c.status_display}</span>
                                        </td>
                                        <td className="p-3 text-right">
                                            <button className="btn-ghost btn-sm">Détail</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detail modal */}
            {selectedId && detail && (
                <div
                    className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={closeCredit}
                >
                    <div
                        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="card-header flex items-center justify-between bg-warning text-white">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <CreditCard size={20} />
                                Crédit #{detail.id} — {detail.customer_name}
                            </h3>
                            <button onClick={closeCredit} aria-label="Fermer" className="hover:bg-white/20 p-1 rounded">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-5">
                            {/* Summary */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                <div className="bg-tertiary/40 rounded-lg p-3">
                                    <p className="text-xs uppercase text-muted">Total</p>
                                    <p className="font-bold text-lg">{Number(detail.sale_total).toFixed(2)} DH</p>
                                </div>
                                <div className="bg-tertiary/40 rounded-lg p-3">
                                    <p className="text-xs uppercase text-muted">Payé</p>
                                    <p className="font-bold text-lg text-success">{Number(detail.paid_amount).toFixed(2)} DH</p>
                                </div>
                                <div className="bg-tertiary/40 rounded-lg p-3">
                                    <p className="text-xs uppercase text-muted">Restant</p>
                                    <p className="font-bold text-lg text-danger">{Number(detail.remaining_amount).toFixed(2)} DH</p>
                                </div>
                            </div>

                            {detail.customer_phone && (
                                <div className="flex items-center gap-2 text-sm text-muted">
                                    <User size={16} />
                                    <span>{detail.customer_name}</span>
                                    <Phone size={14} className="ml-2" />
                                    <span>{detail.customer_phone}</span>
                                </div>
                            )}

                            {/* Items */}
                            <div>
                                <h4 className="font-semibold flex items-center gap-2 mb-2">
                                    <Receipt size={16} /> Articles
                                </h4>
                                <div className="rounded-lg border border-border overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-tertiary/40 text-muted text-xs uppercase">
                                            <tr>
                                                <th className="p-2 text-left">Produit</th>
                                                <th className="p-2 text-right">Qté</th>
                                                <th className="p-2 text-right">PU</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(detail.items || []).map(item => (
                                                <tr key={item.id} className="border-t border-border">
                                                    <td className="p-2">{item.product_name}</td>
                                                    <td className="p-2 text-right">{item.quantity}</td>
                                                    <td className="p-2 text-right font-mono">{Number(item.unit_price_ht).toFixed(2)} DH</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Payments history */}
                            <div>
                                <h4 className="font-semibold flex items-center gap-2 mb-2">
                                    <Banknote size={16} /> Historique des règlements
                                </h4>
                                {(detail.payments || []).length === 0 ? (
                                    <p className="text-sm text-muted">Aucun règlement enregistré.</p>
                                ) : (
                                    <div className="rounded-lg border border-border overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-tertiary/40 text-muted text-xs uppercase">
                                                <tr>
                                                    <th className="p-2 text-left">Date</th>
                                                    <th className="p-2 text-right">Montant</th>
                                                    <th className="p-2 text-left">Note</th>
                                                    <th className="p-2 text-left">Par</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(detail.payments || []).map(p => (
                                                    <tr key={p.id} className="border-t border-border">
                                                        <td className="p-2 text-muted">{formatDate(p.created_at)}</td>
                                                        <td className="p-2 text-right font-mono text-success">+{Number(p.amount).toFixed(2)} DH</td>
                                                        <td className="p-2">{p.note}</td>
                                                        <td className="p-2 text-muted">{p.created_by_name}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Pay form */}
                            {detail.status !== 'PAID' && (
                                <div className="rounded-xl border-2 border-warning/40 bg-warning-light/30 p-4 space-y-3">
                                    <h4 className="font-bold flex items-center gap-2">
                                        <Check size={18} /> Enregistrer un règlement (espèces)
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs font-medium text-muted">Montant (max {Number(detail.remaining_amount).toFixed(2)} DH)</label>
                                            <div className="flex rounded-xl border-2 border-border bg-secondary focus-within:border-warning mt-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="0.00"
                                                    value={paymentInput}
                                                    onChange={e => setPaymentInput(normalizeDecimalInput(e.target.value))}
                                                    className="money-input w-full px-3 py-2 font-bold"
                                                />
                                                <span className="px-3 flex items-center text-muted font-bold border-l border-border">DH</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-muted">Note (optionnel)</label>
                                            <input
                                                type="text"
                                                value={paymentNote}
                                                onChange={e => setPaymentNote(e.target.value)}
                                                className="input w-full mt-1"
                                                placeholder="Ex. acompte"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={payFullBalance}
                                            disabled={payMutation.isPending}
                                            className="btn-ghost btn-sm"
                                        >
                                            Solde total
                                        </button>
                                        <button
                                            onClick={submitPayment}
                                            disabled={payMutation.isPending}
                                            className="btn-primary flex-1 py-2 font-bold"
                                        >
                                            {payMutation.isPending ? 'Enregistrement...' : 'Valider le règlement'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
