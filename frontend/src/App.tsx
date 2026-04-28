import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import AdminRoute from './components/AdminRoute';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import Login from './pages/Login';
import POS from './pages/POS';
import Inventory from './pages/Inventory';
import Dashboard from './pages/Dashboard';
import Suppliers from './pages/Suppliers';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Returns from './pages/Returns';
import PurchaseOrders from './pages/PurchaseOrders';
import StockCount from './pages/StockCount';
import Zakat from './pages/Zakat';
import Accounting from './pages/Accounting';
import CashRegister from './pages/CashRegister';

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
            <Route path="accounting" element={<AdminRoute><Accounting /></AdminRoute>} />
          </Route>
        </Routes>
        <PWAInstallPrompt />
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;

