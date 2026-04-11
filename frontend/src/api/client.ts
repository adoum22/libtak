import axios from 'axios';

// S-07: API URL must be provided via environment variable VITE_API_URL.
// Never hardcode production URLs in source code — they end up in the public JS bundle.
// Set VITE_API_URL in your .env file (see frontend/.env.example).
const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
    console.error(
        '[libtak] VITE_API_URL is not set. ' +
        'Create a frontend/.env file with: VITE_API_URL=http://localhost:8000/api'
    );
}

const client = axios.create({
    baseURL: API_URL || 'http://localhost:8000/api',  // Fallback for dev only
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 10000, // 10 second timeout
});

// ---------------------------------------------------------------------------
// S-08 — SECURITY NOTE: JWT tokens are stored in localStorage.
// This makes them readable by any JavaScript on the page (XSS risk).
// The recommended alternative is HttpOnly cookies (set by the server,
// unreadable by JS), but that requires backend changes to set/clear cookies
// on login/logout and CSRF protection for state-changing requests.
//
// For now: ensure no untrusted third-party scripts are loaded, enforce a
// strict Content-Security-Policy, and keep the access token lifetime short
// (currently 15 minutes). The risk window is limited because even if a token
// is stolen, it expires in 15 minutes and cannot be refreshed without the
// refresh token (also in localStorage — same caveat applies).
//
// To fully eliminate this risk: migrate to HttpOnly cookie auth.
// ---------------------------------------------------------------------------

// Track whether a token refresh is in progress to avoid concurrent refreshes
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
    refreshSubscribers.push(cb);
}

function onTokenRefreshed(newToken: string) {
    refreshSubscribers.forEach(cb => cb(newToken));
    refreshSubscribers = [];
}

// Request interceptor — attach access token to every request
client.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — silently refresh the access token on 401
// S-19: With a 15-minute access token, this interceptor is critical.
// When the server returns 401, we attempt one silent refresh using the
// refresh token. All concurrent requests are queued and replayed once
// the new access token is obtained.
client.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // If 401 and we haven't already retried this request
        if (error.response?.status === 401 && !originalRequest._retry) {
            const currentPath = window.location.pathname;

            // Don't try to refresh if we're already on the login page
            if (currentPath === '/login') {
                return Promise.reject(error);
            }

            const refreshToken = localStorage.getItem('refreshToken');
            if (!refreshToken) {
                // No refresh token — force logout
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('userRole');
                window.location.href = '/login';
                return Promise.reject(error);
            }

            if (isRefreshing) {
                // Another refresh is already in progress — queue this request
                return new Promise((resolve) => {
                    subscribeTokenRefresh((newToken: string) => {
                        originalRequest.headers.Authorization = `Bearer ${newToken}`;
                        resolve(client(originalRequest));
                    });
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const response = await axios.post(
                    `${API_URL || 'http://localhost:8000/api'}/auth/refresh/`,
                    { refresh: refreshToken }
                );
                const newAccessToken = response.data.access;
                // Store the new refresh token if the server rotated it
                if (response.data.refresh) {
                    localStorage.setItem('refreshToken', response.data.refresh);
                }
                localStorage.setItem('token', newAccessToken);

                // Replay all queued requests with the new token
                onTokenRefreshed(newAccessToken);
                isRefreshing = false;

                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                return client(originalRequest);
            } catch (refreshError) {
                // Refresh failed — session expired, force logout
                isRefreshing = false;
                refreshSubscribers = [];
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('userRole');
                window.location.href = '/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export const getApiUrl = () => API_URL || 'http://localhost:8000/api';

export default client;
