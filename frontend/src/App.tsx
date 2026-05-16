import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import AdminRoute from './components/AdminRoute';
import PWAInstallPrompt from './components/PWAInstallPrompt';

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

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted">
      Chargement...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="pos" element={<POS />} />
              <Route path="cash-register" element={<AdminRoute><CashRegister /></AdminRoute>} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="suppliers" element={<AdminRoute><Suppliers /></AdminRoute>} />
              <Route path="reports" element={<AdminRoute><Reports /></AdminRoute>} />
              <Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
              <Route path="settings" element={<AdminRoute><Settings /></AdminRoute>} />
              <Route path="returns" element={<AdminRoute><Returns /></AdminRoute>} />
              <Route path="purchase-orders" element={<AdminRoute><PurchaseOrders /></AdminRoute>} />
              <Route path="stock-count" element={<AdminRoute><StockCount /></AdminRoute>} />
              <Route path="zakat" element={<AdminRoute><Zakat /></AdminRoute>} />
              <Route path="accounting" element={<Accounting />} />
              <Route path="credit" element={<Credit />} />
              <Route path="activity" element={<AdminRoute><ActivityLog /></AdminRoute>} />
            </Route>
          </Routes>
        </Suspense>
        <PWAInstallPrompt />
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;

