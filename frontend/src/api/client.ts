import axios, {
    type AxiosError,
    type InternalAxiosRequestConfig,
} from 'axios';
import { clearPrivateSessionStorage } from '../utils/privateSessionStorage';

const configuredApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const API_URL = (configuredApiUrl || '/api').replace(/\/$/, '');

const ACCESS_TOKEN_KEY = 'libtak.accessToken';
const REFRESH_TOKEN_KEY = 'libtak.refreshToken';
const USER_ROLE_KEY = 'libtak.userRole';

// One-time migration away from persistent localStorage credentials.
const legacyAccess = localStorage.getItem('token');
const legacyRefresh = localStorage.getItem('refreshToken');
const legacyRole = localStorage.getItem('userRole');
if (legacyAccess && !sessionStorage.getItem(ACCESS_TOKEN_KEY)) {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, legacyAccess);
}
if (legacyRefresh && !sessionStorage.getItem(REFRESH_TOKEN_KEY)) {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, legacyRefresh);
}
if (legacyRole && !sessionStorage.getItem(USER_ROLE_KEY)) {
    sessionStorage.setItem(USER_ROLE_KEY, legacyRole);
}
localStorage.removeItem('token');
localStorage.removeItem('refreshToken');
localStorage.removeItem('userRole');

export const getAccessToken = () => sessionStorage.getItem(ACCESS_TOKEN_KEY);
export const getRefreshToken = () => sessionStorage.getItem(REFRESH_TOKEN_KEY);
export const getStoredUserRole = () => sessionStorage.getItem(USER_ROLE_KEY);
export const hasAuthSession = () => Boolean(getAccessToken() || getRefreshToken());

export const setAuthSession = (
    access: string,
    refresh?: string | null,
    role?: string | null,
) => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, access);
    if (refresh) sessionStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    if (role) sessionStorage.setItem(USER_ROLE_KEY, role);
    window.dispatchEvent(new Event('auth:changed'));
};

export const setStoredUserRole = (role: string) => {
    sessionStorage.setItem(USER_ROLE_KEY, role);
    window.dispatchEvent(new Event('auth:changed'));
};

export const clearAuthSession = () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(USER_ROLE_KEY);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userRole');
    clearPrivateSessionStorage();
    window.dispatchEvent(new Event('auth:changed'));
};

const client = axios.create({
    baseURL: API_URL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 15_000,
});

client.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

type RetryableRequest = InternalAxiosRequestConfig & { _authRetry?: boolean };
let refreshPromise: Promise<string> | null = null;
let redirectingToLogin = false;

const refreshAccessToken = async () => {
    if (refreshPromise) return refreshPromise;
    const refresh = getRefreshToken();
    if (!refresh) throw new Error('No refresh token');

    refreshPromise = axios.post(
        `${API_URL}/auth/refresh/`,
        { refresh },
        { timeout: 15_000, headers: { 'Content-Type': 'application/json' } },
    ).then((response) => {
        const access = response.data?.access;
        if (typeof access !== 'string' || !access) {
            throw new Error('Invalid refresh response');
        }
        setAuthSession(
            access,
            typeof response.data?.refresh === 'string' ? response.data.refresh : refresh,
        );
        return access;
    }).finally(() => {
        refreshPromise = null;
    });
    return refreshPromise;
};

const redirectToLogin = () => {
    clearAuthSession();
    if (redirectingToLogin || window.location.pathname === '/login') return;
    redirectingToLogin = true;
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
};

client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const request = error.config as RetryableRequest | undefined;
        const isAuthEndpoint = request?.url?.includes('/auth/login/')
            || request?.url?.includes('/auth/refresh/');
        if (
            error.response?.status === 401
            && request
            && !request._authRetry
            && !isAuthEndpoint
            && getRefreshToken()
        ) {
            request._authRetry = true;
            try {
                const access = await refreshAccessToken();
                request.headers.Authorization = `Bearer ${access}`;
                return client(request);
            } catch {
                redirectToLogin();
            }
        } else if (error.response?.status === 401 && !isAuthEndpoint) {
            redirectToLogin();
        }
        return Promise.reject(error);
    },
);

export const getApiUrl = () => API_URL;
export const isUsingLocalServer = () => (
    !configuredApiUrl
    || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const firstString = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    return null;
};

export const getApiErrorMessage = (
    error: unknown,
    fallback = 'Erreur inconnue',
    field?: string,
) => {
    if (!isRecord(error)) return fallback;
    const response = isRecord(error.response) ? error.response : null;
    const data = response && isRecord(response.data) ? response.data : null;
    if (field && data) {
        const fieldMessage = firstString(data[field]);
        if (fieldMessage) return fieldMessage;
    }
    const detail = data ? firstString(data.detail) : null;
    if (detail) return detail;
    if (data) {
        const firstField = Object.values(data)
            .map(firstString)
            .find((value): value is string => Boolean(value));
        return firstField || fallback;
    }
    const statusText = response ? firstString(response.statusText) : null;
    if (statusText) return statusText;
    return firstString(error.message) || fallback;
};

export const getApiErrorStatus = (error: unknown): number | null => {
    if (!isRecord(error) || !isRecord(error.response)) return null;
    return typeof error.response.status === 'number' ? error.response.status : null;
};

export default client;
