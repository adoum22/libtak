import { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, Cloud } from 'lucide-react';
import { getApiUrl, isUsingLocalServer } from '../api/client';

interface SyncState {
    status: 'synced' | 'syncing' | 'offline' | 'error';
    lastSync: Date | null;
    message: string;
}

export default function SyncStatus() {
    const [syncState, setSyncState] = useState<SyncState>({
        status: 'synced',
        lastSync: null,
        message: 'Connecté'
    });

    const checkCloudStatus = async () => {
        if (!isUsingLocalServer()) {
            // If using cloud directly, show cloud icon
            setSyncState({
                status: 'synced',
                lastSync: new Date(),
                message: 'Mode distant'
            });
            return;
        }

        try {
            // Check if local server is running
            const localResponse = await fetch('http://localhost:8001/api/', {
                method: 'GET',
                mode: 'cors'
            });

            if (localResponse.ok) {
                setSyncState({
                    status: 'synced',
                    lastSync: new Date(),
                    message: 'Local'
                });
            }
        } catch {
            setSyncState({
                status: 'error',
                lastSync: null,
                message: 'Serveur local non disponible'
            });
        }
    };

    useEffect(() => {
        checkCloudStatus();
        // Check every 30 seconds
        const interval = setInterval(checkCloudStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    const getStatusIcon = () => {
        switch (syncState.status) {
            case 'synced':
                return isUsingLocalServer()
                    ? <Wifi size={16} className="text-success" />
                    : <Cloud size={16} className="text-accent" />;
            case 'syncing':
                return <RefreshCw size={16} className="text-warning animate-spin" />;
            case 'offline':
            case 'error':
                return <WifiOff size={16} className="text-danger" />;
        }
    };

    const getStatusColor = () => {
        switch (syncState.status) {
            case 'synced': return 'bg-success/10 text-success border-success/20';
            case 'syncing': return 'bg-warning/10 text-warning border-warning/20';
            case 'offline':
            case 'error': return 'bg-danger/10 text-danger border-danger/20';
        }
    };

    return (
        <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${getStatusColor()}`}
            title={`API: ${getApiUrl()}\n${syncState.message}`}
        >
            {getStatusIcon()}
            <span className="hidden sm:inline">{syncState.message}</span>
        </div>
    );
}
