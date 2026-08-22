import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import client, { hasAuthSession } from '../api/client';
import { canAccessStock, type CurrentUserPermissions } from '../utils/stockPermissions';
import { useTranslation } from 'react-i18next';

export default function StockRoute({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    const authenticated = hasAuthSession();
    const { data, isLoading, isError, refetch, isFetching } = useQuery<CurrentUserPermissions>({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then((response) => response.data),
        enabled: authenticated,
        retry: 1,
        staleTime: 60_000,
    });

    if (!authenticated) return <Navigate to="/login" replace />;
    if (isLoading) {
        return <div className="p-8 text-center text-muted" role="status">{t('CheckingPermissions')}</div>;
    }
    if (isError) {
        return (
            <div className="empty-state" role="alert">
                <h2>{t('PermissionCheckFailed')}</h2>
                <p>{t('CheckConnectionRetry')}</p>
                <button type="button" className="btn-primary" onClick={() => void refetch()} disabled={isFetching}>
                    {isFetching ? t('TryingAgain') : t('Retry')}
                </button>
            </div>
        );
    }
    if (!canAccessStock(data)) return <Navigate to="/forbidden" replace />;
    return <>{children}</>;
}
