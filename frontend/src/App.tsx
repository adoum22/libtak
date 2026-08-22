import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import AdminRoute from './components/AdminRoute';
import StockRoute from './components/StockRoute';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import NetworkStatusBanner from './components/NetworkStatusBanner';
import { hasAuthSession } from './api/client';

const Login = lazy(() => import('./pages/Login'));
const POS = lazy(() => import('./pages/POS'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));
const Returns = lazy(() => import('./pages/Returns'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const StockCount = lazy(() => import('./pages/StockCount'));
const Zakat = lazy(() => import('./pages/Zakat'));
const Accounting = lazy(() => import('./pages/Accounting'));
const CashRegister = lazy(() => import('./pages/CashRegister'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const Credit = lazy(() => import('./pages/Credit'));
const Discounts = lazy(() => import('./pages/Discounts'));
const AccessDenied = lazy(() => import('./pages/AccessDenied'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageLoader() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col gap-3 items-center justify-center text-muted" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{t('Loading')}</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!hasAuthSession()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

const routeTitleKeys: Record<string, string> = {
  '/': 'Dashboard',
  '/login': 'Login',
  '/pos': 'POS',
  '/credit': 'Credit',
  '/cash-register': 'CashRegister',
  '/inventory': 'Inventory',
  '/suppliers': 'Suppliers',
  '/reports': 'Reports',
  '/users': 'Users',
  '/settings': 'Settings',
  '/returns': 'Returns',
  '/purchase-orders': 'PurchaseOrders',
  '/stock-count': 'StockCount',
  '/zakat': 'Zakat',
  '/accounting': 'Accounting',
  '/activity': 'Activity',
  '/discounts': 'Discounts',
  '/forbidden': 'AccessDenied',
};

function RouteContextAnnouncer() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const pageName = t(routeTitleKeys[pathname] || 'PageNotFound');
  const title = `${pageName} — Librairie POS`;

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {title}
    </span>
  );
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <RouteContextAnnouncer />
        <NetworkStatusBanner />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<AdminRoute redirectTo="/pos"><Dashboard /></AdminRoute>} />
              <Route path="pos" element={<POS />} />
              <Route path="credit" element={<Credit />} />
              <Route path="cash-register" element={<AdminRoute><CashRegister /></AdminRoute>} />
              <Route path="inventory" element={<StockRoute><Inventory /></StockRoute>} />
              <Route path="suppliers" element={<AdminRoute><Suppliers /></AdminRoute>} />
              <Route path="reports" element={<AdminRoute><Reports /></AdminRoute>} />
              <Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
              <Route path="settings" element={<AdminRoute><Settings /></AdminRoute>} />
              <Route path="returns" element={<AdminRoute><Returns /></AdminRoute>} />
              <Route path="purchase-orders" element={<AdminRoute><PurchaseOrders /></AdminRoute>} />
              <Route path="stock-count" element={<AdminRoute><StockCount /></AdminRoute>} />
              <Route path="zakat" element={<AdminRoute><Zakat /></AdminRoute>} />
              <Route path="accounting" element={<Accounting />} />
              <Route path="activity" element={<AdminRoute><ActivityLog /></AdminRoute>} />
              <Route path="discounts" element={<AdminRoute><Discounts /></AdminRoute>} />
              <Route path="forbidden" element={<AccessDenied />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <PWAInstallPrompt />
        <PWAUpdatePrompt />
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;

