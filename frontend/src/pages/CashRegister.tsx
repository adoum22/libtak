import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertCircle,
    Banknote,
    Calculator,
    CheckCircle2,
    History,
    Package,
    Save,
    Wallet,
} from 'lucide-react';
import client, { getApiErrorMessage } from '../api/client';
import { useToast } from '../components/ToastContext';
import { normalizeDecimalInput, parseDecimalInput } from '../utils/numberInput';

interface CashAdjustment {
    id: number;
    adjustment_type: 'OPENING' | 'COUNT' | 'MANUAL';
    amount: number;
    counted_amount: number | null;
    note: string;
    created_by_name: string | null;
    created_at: string;
}

interface CashRegisterSummary {
    balance: number;
    opening_amount: number;
    cash_sales_total: number;
    returns_total: number;
    expenses_total: number;
    supplier_payments_total: number;
    adjustments_total: number;
    last_adjustment: CashAdjustment | null;
    recent_adjustments: CashAdjustment[];
}

const fmt = (value: number | string | null | undefined) =>
    (Number(value) || 0).toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

const parseMoney = (value: string) => parseDecimalInput(value);

const adjustmentLabel = (type: CashAdjustment['adjustment_type']) => {
    if (type === 'OPENING') return 'Fonds de départ';
    if (type === 'COUNT') return 'Comptage réel';
    return 'Ajustement';
};

export default function CashRegister() {
    const toast = useToast();
    const queryClient = useQueryClient();
    const [openingAmount, setOpeningAmount] = useState('');
    const [countedAmount, setCountedAmount] = useState('');
    const [note, setNote] = useState('');
    const [openingOperationId, setOpeningOperationId] = useState(() => globalThis.crypto.randomUUID());
    const [countOperationId, setCountOperationId] = useState(() => globalThis.crypto.randomUUID());

    const { data, isLoading, isError, refetch } = useQuery<CashRegisterSummary>({
        queryKey: ['cashRegister'],
        queryFn: () => client.get('/accounting/cash-register/').then(res => res.data),
    });

    const balance = data?.balance ?? 0;
    const counted = parseMoney(countedAmount);
    const countDelta = Number.isFinite(counted) ? counted - balance : 0;

    const stats = useMemo(() => [
        {
            label: 'Fonds de départ',
            value: data?.opening_amount ?? 0,
            icon: Wallet,
            tone: 'accent',
        },
        {
            label: 'Ventes espèces',
            value: data?.cash_sales_total ?? 0,
            icon: Banknote,
            tone: 'success',
        },
        {
            label: 'Dépenses sorties',
            value: data?.expenses_total ?? 0,
            icon: Calculator,
            tone: 'danger',
        },
        {
            label: 'Retours rembourses',
            value: data?.returns_total ?? 0,
            icon: History,
            tone: 'warning',
        },
        {
            label: 'Fournisseurs (espèces)',
            value: data?.supplier_payments_total ?? 0,
            icon: Package,
            tone: 'warning',
        },
    ], [data]);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['cashRegister'] });

    const setOpeningMutation = useMutation({
        mutationFn: () => client.post('/accounting/cash-register/', {
            action: 'set_opening',
            opening_amount: openingAmount,
            note: 'Fonds de caisse defini',
            operation_id: openingOperationId,
        }),
        onSuccess: () => {
            setOpeningAmount('');
            setOpeningOperationId(globalThis.crypto.randomUUID());
            toast.success('Fonds de caisse enregistre.');
            refresh();
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, 'Impossible d enregistrer le fonds.'));
        },
    });

    const countMutation = useMutation({
        mutationFn: () => client.post('/accounting/cash-register/', {
            action: 'count',
            counted_amount: countedAmount,
            note: note.trim() || 'Reglage apres comptage reel',
            operation_id: countOperationId,
        }),
        onSuccess: () => {
            setCountedAmount('');
            setNote('');
            setCountOperationId(globalThis.crypto.randomUUID());
            toast.success('Caisse reglee sur le montant compte.');
            refresh();
        },
        onError: (error: unknown) => {
            toast.error(getApiErrorMessage(error, 'Impossible de regler la caisse.'));
        },
    });

    if (isLoading) {
        return <div className="text-center py-12 text-muted" role="status">Chargement de la caisse…</div>;
    }

    if (isError) {
        return (
            <div className="space-y-6">
                <h1 className="text-3xl font-bold">Caisse</h1>
                <div className="network-error-state" role="alert">
                    <p className="font-semibold">Les données de caisse sont indisponibles.</p>
                    <p className="text-sm mt-2">Aucun solde n’est affiché pour éviter de présenter un montant erroné.</p>
                    <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>Réessayer</button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <Wallet className="text-accent" size={28} />
                        <h1 className="text-3xl font-bold">Caisse</h1>
                    </div>
                    <p className="text-muted">
                        Suivi théorique de l’argent disponible dans la caisse physique.
                    </p>
                </div>
                <div className="card px-6 py-4 min-w-[280px] border-t-4 border-t-accent">
                    <p className="text-sm text-muted uppercase font-semibold">Solde théorique</p>
                    <p className="text-4xl font-black text-accent mt-1">{fmt(balance)} DH</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <div key={stat.label} className="stat-card">
                            <div className={`stat-icon bg-${stat.tone === 'danger' ? 'danger' : stat.tone === 'warning' ? 'warning' : stat.tone === 'success' ? 'success' : 'accent'}-light text-${stat.tone === 'danger' ? 'danger' : stat.tone === 'warning' ? 'warning' : stat.tone === 'success' ? 'success' : 'accent'}`}>
                                <Icon size={24} />
                            </div>
                            <div>
                                <p className="stat-label">{stat.label}</p>
                                <p className="stat-value">{fmt(stat.value)} DH</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="card">
                    <div className="card-header flex items-center gap-3">
                        <Save className="text-accent" />
                        <div>
                            <h2 className="text-xl font-bold">Fonds de départ</h2>
                            <p className="text-sm text-muted">À utiliser au début, par exemple 500 DH.</p>
                        </div>
                    </div>
                    <div className="card-body space-y-4">
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">Montant initial</span>
                            <div className="flex rounded-xl border border-border bg-secondary focus-within:border-accent mt-2">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="money-input text-2xl font-bold py-3 pl-4 pr-3"
                                    placeholder="0.00"
                                    value={openingAmount}
                                    onChange={(event) => {
                                        setOpeningAmount(normalizeDecimalInput(event.target.value));
                                        setOpeningOperationId(globalThis.crypto.randomUUID());
                                    }}
                                />
                                <span className="px-4 flex items-center text-muted font-bold border-l border-border">DH</span>
                            </div>
                        </label>
                        <button
                            type="button"
                            className="btn-primary w-full py-3 font-bold"
                            disabled={!Number.isFinite(parseMoney(openingAmount)) || parseMoney(openingAmount) < 0 || setOpeningMutation.isPending}
                            onClick={() => setOpeningMutation.mutate()}
                        >
                            <Save size={18} />
                            Enregistrer le fonds
                        </button>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header flex items-center gap-3">
                        <Calculator className="text-accent" />
                        <div>
                            <h2 className="text-xl font-bold">Réglage après comptage</h2>
                            <p className="text-sm text-muted">Saisissez le montant réel compté dans la caisse.</p>
                        </div>
                    </div>
                    <div className="card-body space-y-4">
                        <label className="block">
                            <span className="text-sm font-semibold text-muted">Montant réel</span>
                            <div className="flex rounded-xl border border-border bg-secondary focus-within:border-accent mt-2">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="money-input text-2xl font-bold py-3 pl-4 pr-3"
                                    placeholder="0.00"
                                    value={countedAmount}
                                    onChange={(event) => {
                                        setCountedAmount(normalizeDecimalInput(event.target.value));
                                        setCountOperationId(globalThis.crypto.randomUUID());
                                    }}
                                />
                                <span className="px-4 flex items-center text-muted font-bold border-l border-border">DH</span>
                            </div>
                        </label>
                        <div className={`p-4 rounded-xl flex items-center justify-between ${countDelta < 0 ? 'bg-danger-light text-danger' : 'bg-success-light text-success'}`}>
                            <span className="font-semibold">Écart avec le théorique</span>
                            <span className="text-2xl font-bold">{fmt(countDelta)} DH</span>
                        </div>
                        <input
                            aria-label="Note du comptage"
                            type="text"
                            placeholder="Note optionnelle"
                            value={note}
                            onChange={(event) => {
                                setNote(event.target.value);
                                setCountOperationId(globalThis.crypto.randomUUID());
                            }}
                        />
                        <button
                            type="button"
                            className="btn-primary w-full py-3 font-bold"
                            disabled={!Number.isFinite(counted) || counted < 0 || countMutation.isPending}
                            onClick={() => countMutation.mutate()}
                        >
                            <CheckCircle2 size={18} />
                            Régler la caisse
                        </button>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header flex items-center gap-3">
                    <History className="text-accent" />
                    <h2 className="text-xl font-bold">Derniers réglages</h2>
                </div>
                <div className="card-body">
                    {isLoading ? (
                        <p className="text-muted text-center py-8">Chargement...</p>
                    ) : !data?.recent_adjustments.length ? (
                        <div className="text-center py-10 text-muted">
                            <AlertCircle className="mx-auto mb-3" />
                            Aucun réglage de caisse pour le moment.
                        </div>
                    ) : (
                        <>
                            <div className="cash-mobile-adjustments">
                                {data.recent_adjustments.map((adjustment) => (
                                    <div key={`mobile-${adjustment.id}`} className="mobile-detail-card">
                                        <div className="mobile-detail-card-header">
                                            <div>
                                                <h3>{adjustmentLabel(adjustment.adjustment_type)}</h3>
                                                <p>{new Date(adjustment.created_at).toLocaleString('fr-FR')}</p>
                                            </div>
                                            <strong className={adjustment.amount < 0 ? 'text-danger' : 'text-success'}>
                                                {adjustment.amount >= 0 ? '+' : ''}{fmt(adjustment.amount)} DH
                                            </strong>
                                        </div>
                                        <div className="mobile-money-grid">
                                            <div>
                                                <span>Compté</span>
                                                <strong>{adjustment.counted_amount !== null ? `${fmt(adjustment.counted_amount)} DH` : '-'}</strong>
                                            </div>
                                            <div>
                                                <span>Utilisateur</span>
                                                <strong>{adjustment.created_by_name || '-'}</strong>
                                            </div>
                                        </div>
                                        {adjustment.note && <p className="mobile-note">{adjustment.note}</p>}
                                    </div>
                                ))}
                            </div>
                            <div className="overflow-x-auto">
                                <table>
                                <caption className="sr-only">Derniers réglages de caisse</caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Type</th>
                                        <th scope="col">Montant compté</th>
                                        <th scope="col">Ajustement</th>
                                        <th scope="col">Note</th>
                                        <th scope="col">Utilisateur</th>
                                        <th scope="col">Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.recent_adjustments.map((adjustment) => (
                                        <tr key={adjustment.id}>
                                            <td className="font-semibold">{adjustmentLabel(adjustment.adjustment_type)}</td>
                                            <td>{adjustment.counted_amount !== null ? `${fmt(adjustment.counted_amount)} DH` : '-'}</td>
                                            <td className={adjustment.amount < 0 ? 'text-danger font-bold' : 'text-success font-bold'}>
                                                {fmt(adjustment.amount)} DH
                                            </td>
                                            <td>{adjustment.note || '-'}</td>
                                            <td>{adjustment.created_by_name || '-'}</td>
                                            <td>{new Date(adjustment.created_at).toLocaleString('fr-FR')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
