import axios from 'axios';

// Local server (runs at the store) - PRIMARY
const LOCAL_API_URL = 'http://localhost:8000/api';

// Cloud server (Render) - for remote access only
const CLOUD_API_URL = import.meta.env.VITE_API_URL || 'https://libtak-api.onrender.com/api';

// Determine which server to use
// In production at the store: use local server
// For remote access (when explicitly set): use cloud
const isRemoteAccess = import.meta.env.VITE_REMOTE_ACCESS === 'true';
const API_URL = isRemoteAccess ? CLOUD_API_URL : LOCAL_API_URL;

const client = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 10000, // 10 second timeout
});

// Request interceptor - add token to every request
client.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor - handle 401 errors
client.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Token expired or invalid
            const currentPath = window.location.pathname;
            if (currentPath !== '/login') {
                localStorage.removeItem('token');
                localStorage.removeItem('userRole');
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

// Export API URL for debugging/status display
export const getApiUrl = () => API_URL;
export const isUsingLocalServer = () => !isRemoteAccess;

export default client;

