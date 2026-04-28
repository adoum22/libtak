import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Clock, Filter, ShieldCheck } from 'lucide-react';
import client from '../api/client';

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

const ACTIONS = [
    { value: '', label: 'Toutes les actions' },
    { value: 'SALE', label: 'Ventes' },
    { value: 'RETURN', label: 'Retours' },
    { value: 'CREATE', label: 'Creation' },
    { value: 'UPDATE', label: 'Modification' },
    { value: 'DELETE', label: 'Suppression' },
    { value: 'LOGIN', label: 'Connexion' },
    { value: 'LOGOUT', label: 'Deconnexion' },
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

    const { data = [], isLoading } = useQuery<AuditLog[]>({
        queryKey: ['auditLogs', action, model],
        queryFn: () => {
            const params = new URLSearchParams();
            if (action) params.set('action', action);
            if (model.trim()) params.set('model', model.trim());
            return client.get(`/auth/audit-logs/?${params.toString()}`).then(res => res.data.results || res.data);
        },
    });

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <ShieldCheck className="text-accent" size={28} />
                        <h1 className="text-3xl font-bold">Activite</h1>
                    </div>
                    <p className="text-muted">Historique des actions sensibles effectuees sur LibTak.</p>
                </div>
                <div className="card px-5 py-3 flex items-center gap-3">
                    <Activity className="text-accent" />
                    <div>
                        <p className="text-sm text-muted">Evenements affiches</p>
                        <p className="text-xl font-bold">{data.length}</p>
                    </div>
                </div>
            </div>

            <div className="card p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2">
                        <Filter size={18} className="text-muted" />
                        <select value={action} onChange={(event) => setAction(event.target.value)}>
                            {ACTIONS.map(item => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                        </select>
                    </div>
                    <input
                        type="text"
                        placeholder="Filtrer par module: Product, Sale..."
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                    />
                    <div className="flex items-center gap-2 text-sm text-muted">
                        <Clock size={18} />
                        Les plus recents sont affiches en premier
                    </div>
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Utilisateur</th>
                                <th>Action</th>
                                <th>Module</th>
                                <th>Objet</th>
                                <th>IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted">Chargement...</td></tr>
                            ) : data.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted">Aucune activite trouvee</td></tr>
                            ) : data.map(log => (
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
            </div>
        </div>
    );
}
