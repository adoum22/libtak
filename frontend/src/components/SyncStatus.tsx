import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, Cloud } from 'lucide-react';
import client, { getApiUrl, isUsingLocalServer } from '../api/client';
import { useTranslation } from 'react-i18next';

interface SyncState {
    status: 'synced' | 'pending' | 'offline' | 'error';
    lastSync: Date | null;
    message: string;
}

interface SyncStatusResponse {
    cloud_configured: boolean;
    last_sync: string | null;
    pending_sales: number;
    pending_returns: number;
    is_local_server: boolean;
}

export default function SyncStatus() {
    const { t } = useTranslation();
    const [syncState, setSyncState] = useState<SyncState>({
        status: 'synced',
        lastSync: null,
        message: t('Connected')
    });

    const checkCloudStatus = useCallback(async () => {
        if (!isUsingLocalServer()) {
            // If using cloud directly, show cloud icon
            setSyncState({
                status: 'synced',
                lastSync: new Date(),
                message: t('RemoteMode')
            });
            return;
        }

        try {
            const response = await client.get<SyncStatusResponse>('/auth/sync/status/');
            const sync = response.data;
            const pending = Number(sync.pending_sales || 0) + Number(sync.pending_returns || 0);
            const lastSync = sync.last_sync ? new Date(sync.last_sync) : null;
            setSyncState({
                status: pending > 0 ? 'pending' : 'synced',
                lastSync,
                message: pending > 0
                    ? `${t('Pending')}: ${pending}`
                    : t('LocalMode'),
            });
        } catch {
            setSyncState({
                status: 'error',
                lastSync: null,
                message: t('LocalServerUnavailable')
            });
        }
    }, [t]);

    useEffect(() => {
        const initialCheck = window.setTimeout(checkCloudStatus, 0);
        // Check every 30 seconds
        const interval = setInterval(checkCloudStatus, 30000);
        return () => {
            window.clearTimeout(initialCheck);
            clearInterval(interval);
        };
    }, [checkCloudStatus]);

    const getStatusIcon = () => {
        switch (syncState.status) {
            case 'synced':
                return isUsingLocalServer()
                    ? <Wifi size={16} className="text-success" />
                    : <Cloud size={16} className="text-accent" />;
            case 'pending':
                return <RefreshCw size={16} className="text-warning" />;
            case 'offline':
            case 'error':
                return <WifiOff size={16} className="text-danger" />;
        }
    };

    const getStatusColor = () => {
        switch (syncState.status) {
            case 'synced': return 'bg-success/10 text-success border-success/20';
            case 'pending': return 'bg-warning/10 text-warning border-warning/20';
            case 'offline':
            case 'error': return 'bg-danger/10 text-danger border-danger/20';
        }
    };

    return (
        <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${getStatusColor()}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            title={`API: ${getApiUrl()}\n${syncState.message}${syncState.lastSync ? `\n${syncState.lastSync.toLocaleString()}` : ''}`}
        >
            <span aria-hidden="true">{getStatusIcon()}</span>
            <span className="sr-only">{syncState.message}</span>
            <span className="hidden sm:inline" aria-hidden="true">{syncState.message}</span>
        </div>
    );
}
