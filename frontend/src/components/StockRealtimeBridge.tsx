import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getAccessToken, getApiUrl } from '../api/client';


const websocketUrl = () => {
    const api = new URL(getApiUrl(), window.location.origin);
    const path = api.pathname.replace(/\/api\/?$/, '').replace(/\/$/, '');
    api.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
    api.pathname = `${path}/ws/stock/`;
    api.search = '';
    api.hash = '';
    return api.toString();
};

export default function StockRealtimeBridge() {
    const queryClient = useQueryClient();

    useEffect(() => {
        let socket: WebSocket | null = null;
        let reconnectTimer: number | null = null;
        let stopped = false;
        let retryDelay = 1_000;

        const refreshStockQueries = () => {
            void queryClient.invalidateQueries({ queryKey: ['products'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
            void queryClient.invalidateQueries({ queryKey: ['inventoryStats'] });
        };

        const scheduleReconnect = () => {
            if (stopped || reconnectTimer !== null || !navigator.onLine) return;
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30_000);
        };

        const connect = () => {
            if (stopped || socket || !navigator.onLine) return;
            const accessToken = getAccessToken();
            if (!accessToken) return;

            try {
                socket = new WebSocket(
                    websocketUrl(),
                    ['libtak-stock-v1', `jwt.${accessToken}`],
                );
            } catch {
                socket = null;
                scheduleReconnect();
                return;
            }

            socket.onopen = () => {
                retryDelay = 1_000;
            };
            socket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(String(event.data));
                    if (payload?.type !== 'stock_update') return;
                    refreshStockQueries();
                } catch {
                    // Ignore unrelated or malformed server messages.
                }
            };
            socket.onerror = () => socket?.close();
            socket.onclose = (event) => {
                socket = null;
                // 4403 is a durable permission refusal. 4401 normally means
                // an expired access token; auth:changed reconnects after refresh.
                if (event.code !== 4403 && event.code !== 4401) scheduleReconnect();
            };
        };

        const reconnectForAuthChange = () => {
            if (reconnectTimer !== null) {
                window.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            socket?.close();
            socket = null;
            retryDelay = 1_000;
            connect();
        };
        const handleOnline = () => connect();
        const handleOffline = () => socket?.close();

        window.addEventListener('auth:changed', reconnectForAuthChange);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        connect();
        // Reliable fallback for hosts without WebSocket support.
        const pollingTimer = window.setInterval(refreshStockQueries, 30_000);

        return () => {
            stopped = true;
            if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
            window.clearInterval(pollingTimer);
            socket?.close();
            window.removeEventListener('auth:changed', reconnectForAuthChange);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [queryClient]);

    return null;
}
