import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client, { hasAuthSession } from '../api/client';

export default function AdminRoute({
    children,
    redirectTo = '/forbidden',
}: {
    children: React.ReactNode;
    redirectTo?: string;
}) {
    const authenticated = hasAuthSession();
    const { data, isLoading, isError, refetch, isFetching } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then((response) => response.data),
        enabled: authenticated,
        retry: 1,
        staleTime: 60_000,
    });

    if (!authenticated) return <Navigate to="/login" replace />;
    if (isLoading) {
        return <div className="p-8 text-center text-muted" role="status">Vérification des droits…</div>;
    }
    if (isError) {
        return (
            <div className="empty-state" role="alert">
                <h2>Impossible de vérifier vos droits</h2>
                <p>Contrôlez la connexion puis réessayez.</p>
                <button className="btn-primary" onClick={() => refetch()} disabled={isFetching}>
                    {isFetching ? 'Nouvelle tentative…' : 'Réessayer'}
                </button>
            </div>
        );
    }
    if (data?.role !== 'ADMIN') return <Navigate to={redirectTo} replace />;
    return <>{children}</>;
}
