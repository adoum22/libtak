import axios from 'axios';

// Local server for development
const LOCAL_API_URL = 'http://localhost:8000/api';

// Production server (PythonAnywhere)
const PRODUCTION_API_URL = 'https://dido22.pythonanywhere.com/api';

// Determine which server to use
// In development (localhost): use local server
// In production (Vercel): use PythonAnywhere
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = import.meta.env.VITE_API_URL || (isDevelopment ? LOCAL_API_URL : PRODUCTION_API_URL);

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
export const isUsingLocalServer = () => isDevelopment;

export default client;

