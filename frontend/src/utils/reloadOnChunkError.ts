const CHUNK_RELOAD_KEY = 'libtak_chunk_reload_attempted';

export const isChunkLoadError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return [
        'Failed to fetch dynamically imported module',
        'Importing a module script failed',
        'Loading chunk',
        'ChunkLoadError',
    ].some(pattern => message.includes(pattern));
};

export const reloadOnceForNewVersion = async () => {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') {
        return false;
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');

    if ('caches' in window) {
        try {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        } catch {
            // Ignore cache cleanup errors; reloading is still the safest fallback.
        }
    }

    window.location.reload();
    return true;
};

export const clearChunkReloadFlag = () => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
};
