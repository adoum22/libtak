import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock, Filter, ShieldCheck } from 'lucide-react';
import client from '../api/client';
import Pagination from '../components/Pagination';

interface AuditLog {
    id: number;
    username: string | null;
    action: string;
    action_display: string;
    model_name: string;
    object_id: number | null;
    object_repr: string;
    changes: Record<string, unknown>;
    ip_address: string | null;
    timestamp: string;
}

interface AuditLogPage {
    count: number;
    results: AuditLog[];
}

const PAGE_SIZE = 50;

const ACTIONS = [
    { value: '', label: 'Toutes les actions' },
    { value: 'SALE', label: 'Ventes' },
    { value: 'RETURN', label: 'Retours' },
    { value: 'CREATE', label: 'Création' },
    { value: 'UPDATE', label: 'Modification' },
    { value: 'DELETE', label: 'Suppression' },
    { value: 'LOGIN', label: 'Connexion' },
    { value: 'LOGOUT', label: 'Déconnexion' },
    { value: 'STOCK_IN', label: 'Stock entrant' },
    { value: 'STOCK_OUT', label: 'Stock sortant' },
    { value: 'EXPORT', label: 'Export' },
];

const badgeClass = (action: string) => {
    if (action === 'DELETE') return 'badge-danger';
    if (action === 'SALE' || action === 'STOCK_IN') return 'badge-success';
    if (action === 'RETURN' || action === 'STOCK_OUT') return 'badge-warning';
    return 'badge-accent';
};

export default function ActivityLog() {
    const [action, setAction] = useState('');
    const [model, setModel] = useState('');
    const [page, setPage] = useState(1);

    const { data, isLoading, isError, refetch } = useQuery<AuditLogPage>({
        queryKey: ['auditLogs', action, model, page],
        queryFn: () => {
            const params = new URLSearchParams();
            if (action) params.set('action', action);
            if (model.trim()) params.set('model', model.trim());
            params.set('page', String(page));
            return client.get(`/auth/audit-logs/?${params.toString()}`).then(res => ({
                count: Number(res.data?.count ?? (Array.isArray(res.data) ? res.data.length : 0)),
                results: res.data?.results ?? (Array.isArray(res.data) ? res.data : []),
            }));
        },
        placeholderData: previous => previous,
    });
    const logs = data?.results ?? [];
    const totalItems = data?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <ShieldCheck className="text-accent" size={28} />
                        <h1 className="text-3xl font-bold">Activité</h1>
                    </div>
                    <p className="text-muted">Historique des actions sensibles effectuées sur LibTak.</p>
                </div>
                <div className="card px-5 py-3 flex items-center gap-3">
                    <Activity className="text-accent" />
                    <div>
                        <p className="text-sm text-muted">Événements trouvés</p>
                        <p className="text-xl font-bold">{isError ? '—' : totalItems}</p>
                    </div>
                </div>
            </div>

            <div className="card p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2">
                        <Filter size={18} className="text-muted" />
                        <select aria-label="Filtrer par action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
                            {ACTIONS.map(item => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </div>
                    <input
                        type="text"
                        placeholder="Filtrer par module: Product, Sale..."
                        aria-label="Filtrer par module"
                        value={model}
                        onChange={(event) => { setModel(event.target.value); setPage(1); }}
                    />
                    <div className="flex items-center gap-2 text-sm text-muted">
                        <Clock size={18} />
                        Les plus récents sont affichés en premier
                    </div>
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table>
                        <caption className="sr-only">Historique des actions sensibles</caption>
                        <thead>
                            <tr>
                                <th scope="col">Date</th>
                                <th scope="col">Utilisateur</th>
                                <th scope="col">Action</th>
                                <th scope="col">Module</th>
                                <th scope="col">Objet</th>
                                <th scope="col">IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted">Chargement...</td></tr>
                            ) : isError ? (
                                <tr><td colSpan={6} className="text-center py-8"><div className="network-error-state" role="alert"><p>Le journal d’activité est indisponible.</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>Réessayer</button></div></td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted">Aucune activité trouvée</td></tr>
                            ) : logs.map(log => (
                                <tr key={log.id}>
                                    <td>{new Date(log.timestamp).toLocaleString('fr-FR')}</td>
                                    <td className="font-medium">{log.username || '-'}</td>
                                    <td>
                                        <span className={`badge ${badgeClass(log.action)}`}>
                                            {log.action_display || log.action}
                                        </span>
                                    </td>
                                    <td>{log.model_name}</td>
                                    <td>{log.object_repr || (log.object_id ? `#${log.object_id}` : '-')}</td>
                                    <td className="font-mono text-xs text-muted">{log.ip_address || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!isLoading && !isError && (
                    <Pagination currentPage={page} totalPages={totalPages} totalItems={totalItems} pageSize={PAGE_SIZE} onPageChange={setPage} />
                )}
            </div>
        </div>
    );
}
