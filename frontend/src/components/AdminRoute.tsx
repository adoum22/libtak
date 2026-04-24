import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';

export default function AdminRoute({ children }: { children: React.ReactNode }) {
    const token = localStorage.getItem('token');

    const { data, isLoading, isError } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(r => r.data),
        enabled: !!token,
        retry: false,
        staleTime: 60_000,
    });

    if (!token) return <Navigate to="/login" replace />;
    if (isLoading) {
        return <div className="p-8 text-center text-muted">…</div>;
    }
    if (isError || data?.role !== 'ADMIN') {
        return <Navigate to="/" replace />;
    }
    return <>{children}</>;
}
