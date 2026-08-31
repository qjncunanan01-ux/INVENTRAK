import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { clearCurrentUser, clearToken, getCurrentUser, getMe, getToken, logout as apiLogout, setCurrentUser } from './api';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import ApprovalsPage from './pages/ApprovalsPage';
import AuditTrailPage from './pages/AuditTrailPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import LocationsPage from './pages/LocationsPage';
import LoginPage from './pages/LoginPage';
import OptimizationPage from './pages/OptimizationPage';
import OrderInquiriesPage from './pages/OrderInquiriesPage';
import ProductsPage from './pages/ProductsPage';
import ReportsPage from './pages/ReportsPage';
import ScanStockPage from './pages/ScanStockPage';
import SecurityPage from './pages/SecurityPage';
import StockAdjustmentsPage from './pages/StockAdjustmentsPage';
import StockMovementPage from './pages/StockMovementPage';
import StockTransfersPage from './pages/StockTransfersPage';
import { createAppTheme } from './theme';

// Role-based route guard: admin-only modules (products, approvals, orders,
// locations, security) redirect staff accounts to the dashboard instead of
// rendering a page their token can't use. The backend enforces the same
// split, so this is defense in depth, not the only gate.
function RequireRole({ roles, children }) {
  const current = getCurrentUser();
  if (!current || !roles.includes(current.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AppRoutes() {
  const [user, setUser] = useState(null);
  // A saved token survives a page refresh (sessionStorage), so restore the
  // session at boot via /api/auth/me instead of forcing a re-login. Invalid
  // or expired tokens are cleared so the login page starts clean.
  const [restoring, setRestoring] = useState(() => !!getToken());

  useEffect(() => {
    if (!restoring) return;
    getMe()
      .then((me) => {
        setUser(me);
        setCurrentUser(me);
      })
      .catch(() => {
        clearToken();
        clearCurrentUser();
      })
      .finally(() => setRestoring(false));
  }, [restoring]);

  const handleLogin = (u) => {
    setUser(u);
    setCurrentUser(u);
  };

  const handleLogout = () => {
    // Destroy the session server-side too: the token's jti is revoked so a
    // captured token can't be replayed after logout (fire-and-forget — the
    // local session is cleared regardless of network state).
    apiLogout().catch(() => {});
    setUser(null);
    clearToken();
    clearCurrentUser();
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

  if (!user) return <BrowserRouter><Routes><Route path="/*" element={<LoginPage onLogin={handleLogin} />} /></Routes></BrowserRouter>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage user={user} onLogout={handleLogout} />} />
        <Route path="/products" element={<RequireRole roles={['admin']}><ProductsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/inventory" element={<InventoryPage onLogout={handleLogout} />} />
        <Route path="/scan-stock" element={<ScanStockPage onLogout={handleLogout} />} />
        <Route path="/stock-movement" element={<StockMovementPage onLogout={handleLogout} />} />
        <Route path="/stock-adjustments" element={<StockAdjustmentsPage onLogout={handleLogout} />} />
        <Route path="/stock-transfers" element={<StockTransfersPage onLogout={handleLogout} />} />
        <Route path="/approvals" element={<RequireRole roles={['admin']}><ApprovalsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/order-inquiries" element={<RequireRole roles={['admin']}><OrderInquiriesPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/locations" element={<RequireRole roles={['admin']}><LocationsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/optimization" element={<OptimizationPage onLogout={handleLogout} />} />
        <Route path="/reports" element={<ReportsPage onLogout={handleLogout} />} />
        <Route path="/security" element={<RequireRole roles={['admin']}><SecurityPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/audit-trail" element={<RequireRole roles={['admin']}><AuditTrailPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/approvals" element={<RequireRole roles={['admin']}><ApprovalsPage onLogout={handleLogout} /></RequireRole>}/>
        <Route path="/audit-trail" element={<RequireRole roles={['admin']}><AuditTrailPage onLogout={handleLogout} /></RequireRole>} />
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
