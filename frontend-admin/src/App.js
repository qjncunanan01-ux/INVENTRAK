import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { clearToken, getMe, getToken } from './api';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import ApprovalsPage from './pages/ApprovalsPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import LocationsPage from './pages/LocationsPage';
import LoginPage from './pages/LoginPage';
import OptimizationPage from './pages/OptimizationPage';
import OrderInquiriesPage from './pages/OrderInquiriesPage';
import ProductsPage from './pages/ProductsPage';
import ReportsPage from './pages/ReportsPage';
import ScanStockPage from './pages/ScanStockPage';
import StockAdjustmentsPage from './pages/StockAdjustmentsPage';
import StockMovementPage from './pages/StockMovementPage';
import StockTransfersPage from './pages/StockTransfersPage';
import { createAppTheme } from './theme';

function AppRoutes() {
  const [user, setUser] = useState(null);
  // A saved token survives a hard refresh (localStorage), so restore the
  // session at boot via /api/auth/me instead of forcing a re-login. Invalid
  // or expired tokens are cleared so the login page starts clean.
  const [restoring, setRestoring] = useState(() => !!getToken());

  useEffect(() => {
    if (!restoring) return;
    getMe()
      .then((me) => setUser(me))
      .catch(() => clearToken())
      .finally(() => setRestoring(false));
  }, [restoring]);

  const handleLogout = () => {
    setUser(null);
    clearToken();
  };

  if (restoring) {
    return (
      <BrowserRouter>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#666' }}>
          Loading…
        </div>
      </BrowserRouter>
    );
  }

  if (!user) return <BrowserRouter><Routes><Route path="/*" element={<LoginPage onLogin={setUser} />} /></Routes></BrowserRouter>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage user={user} onLogout={handleLogout} />} />
        <Route path="/products" element={<ProductsPage onLogout={handleLogout} />} />
        <Route path="/inventory" element={<InventoryPage onLogout={handleLogout} />} />
        <Route path="/scan-stock" element={<ScanStockPage onLogout={handleLogout} />} />
        <Route path="/stock-movement" element={<StockMovementPage onLogout={handleLogout} />} />
        <Route path="/stock-adjustments" element={<StockAdjustmentsPage onLogout={handleLogout} />} />
        <Route path="/stock-transfers" element={<StockTransfersPage onLogout={handleLogout} />} />
        <Route path="/approvals" element={<ApprovalsPage onLogout={handleLogout} />} />
        <Route path="/order-inquiries" element={<OrderInquiriesPage onLogout={handleLogout} />} />
        <Route path="/locations" element={<LocationsPage onLogout={handleLogout} />} />
        <Route path="/optimization" element={<OptimizationPage onLogout={handleLogout} />} />
        <Route path="/reports" element={<ReportsPage onLogout={handleLogout} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  // The admin is always light mode — dark mode was removed.
  const theme = createAppTheme();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppRoutes />
    </ThemeProvider>
  );
}

export default App;
