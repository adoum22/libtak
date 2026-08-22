import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
    { value: '', key: 'AllActions' },
    { value: 'SALE', key: 'Sales' },
    { value: 'RETURN', key: 'Returns' },
    { value: 'CREATE', key: 'Creation' },
    { value: 'UPDATE', key: 'Update' },
    { value: 'DELETE', key: 'Deletion' },
    { value: 'LOGIN', key: 'SignInAction' },
    { value: 'LOGOUT', key: 'SignOutAction' },
    { value: 'STOCK_IN', key: 'StockIn' },
    { value: 'STOCK_OUT', key: 'StockOut' },
    { value: 'EXPORT', key: 'Export' },
] as const;

const badgeClass = (action: string) => {
    if (action === 'DELETE') return 'badge-danger';
    if (action === 'SALE' || action === 'STOCK_IN') return 'badge-success';
    if (action === 'RETURN' || action === 'STOCK_OUT') return 'badge-warning';
    return 'badge-accent';
};

export default function ActivityLog() {
    const { t, i18n } = useTranslation();
    const actionLabels = Object.fromEntries(ACTIONS.filter(item => item.value).map(item => [item.value, t(item.key)]));
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
                        <h1 className="text-3xl font-bold">{t('Activity')}</h1>
                    </div>
                    <p className="text-muted">{t('SensitiveActionHistory')}</p>
                </div>
                <div className="card px-5 py-3 flex items-center gap-3">
                    <Activity className="text-accent" />
                    <div>
                        <p className="text-sm text-muted">{t('EventsFound')}</p>
                        <p className="text-xl font-bold">{isError ? '—' : totalItems}</p>
                    </div>
                </div>
            </div>

            <div className="card p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2">
                        <Filter size={18} className="text-muted" />
                        <select aria-label={t('FilterByAction')} value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
                            {ACTIONS.map(item => (
                                <option key={item.value} value={item.value}>{t(item.key)}</option>
                            ))}
                        </select>
                    </div>
                    <input
                        type="text"
                        placeholder={t('FilterByModulePlaceholder')}
                        aria-label={t('FilterByModule')}
                        value={model}
                        onChange={(event) => { setModel(event.target.value); setPage(1); }}
                    />
                    <div className="flex items-center gap-2 text-sm text-muted">
                        <Clock size={18} />
                        {t('NewestFirst')}
                    </div>
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table>
                        <caption className="sr-only">{t('SensitiveActionHistory')}</caption>
                        <thead>
                            <tr>
                                <th scope="col">{t('Date')}</th>
                                <th scope="col">{t('User')}</th>
                                <th scope="col">{t('Action')}</th>
                                <th scope="col">{t('Module')}</th>
                                <th scope="col">{t('Object')}</th>
                                <th scope="col">IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted">{t('Loading')}</td></tr>
                            ) : isError ? (
                                <tr><td colSpan={6} className="text-center py-8"><div className="network-error-state" role="alert"><p>{t('ActivityLogUnavailable')}</p><button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>{t('Retry')}</button></div></td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-8 text-muted">{t('NoActivity')}</td></tr>
                            ) : logs.map(log => (
                                <tr key={log.id}>
                                    <td>{new Date(log.timestamp).toLocaleString(i18n.language)}</td>
                                    <td className="font-medium">{log.username || '-'}</td>
                                    <td>
                                        <span className={`badge ${badgeClass(log.action)}`}>
                                            {actionLabels[log.action] || log.action_display || log.action}
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
