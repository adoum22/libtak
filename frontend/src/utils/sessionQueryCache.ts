import type { QueryClient } from '@tanstack/react-query';


export const clearSessionQueryCache = async (queryClient: QueryClient) => {
    await queryClient.cancelQueries();
    queryClient.clear();
};


export const cacheCurrentUser = (
    queryClient: QueryClient,
    user: unknown,
) => {
    queryClient.setQueryData(['currentUser'], user);
};
