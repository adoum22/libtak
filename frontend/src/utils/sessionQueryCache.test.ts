import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { cacheCurrentUser, clearSessionQueryCache } from './sessionQueryCache';


describe('session query cache', () => {
    it('never keeps an administrator profile for the next login', async () => {
        const queryClient = new QueryClient();
        queryClient.setQueryData(['currentUser'], {
            username: 'ancien-admin',
            role: 'ADMIN',
        });
        queryClient.setQueryData(['private-dashboard'], { revenue: 999 });

        await clearSessionQueryCache(queryClient);

        expect(queryClient.getQueryData(['currentUser'])).toBeUndefined();
        expect(queryClient.getQueryData(['private-dashboard'])).toBeUndefined();
    });

    it('primes the layout with the newly authenticated user', () => {
        const queryClient = new QueryClient();
        const cashier = { username: 'vendeur', role: 'CASHIER' };

        cacheCurrentUser(queryClient, cashier);

        expect(queryClient.getQueryData(['currentUser'])).toEqual(cashier);
    });
});
