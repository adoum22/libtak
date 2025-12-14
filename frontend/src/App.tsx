import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
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
            <Route path="inventory" element={<Inventory />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="reports" element={<Reports />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<Settings />} />
            <Route path="returns" element={<Returns />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="stock-count" element={<StockCount />} />
          </Route>
        </Routes>
        <PWAInstallPrompt />
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;

