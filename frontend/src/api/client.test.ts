import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('authentication session storage', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('migrates legacy persistent tokens into the tab session', async () => {
    localStorage.setItem('token', 'legacy-access');
    localStorage.setItem('refreshToken', 'legacy-refresh');
    localStorage.setItem('userRole', 'ADMIN');

    const auth = await import('./client');

    expect(auth.getAccessToken()).toBe('legacy-access');
    expect(auth.getRefreshToken()).toBe('legacy-refresh');
    expect(auth.getStoredUserRole()).toBe('ADMIN');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('stores and clears the complete session atomically', async () => {
    const auth = await import('./client');
    const listener = vi.fn();
    window.addEventListener('auth:changed', listener);

    auth.setAuthSession('access', 'refresh', 'CASHIER');
    expect(auth.hasAuthSession()).toBe(true);
    expect(auth.getStoredUserRole()).toBe('CASHIER');

    auth.clearAuthSession();
    expect(auth.hasAuthSession()).toBe(false);
    expect(auth.getStoredUserRole()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener('auth:changed', listener);
  });
});
