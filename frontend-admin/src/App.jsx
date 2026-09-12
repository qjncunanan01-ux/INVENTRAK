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
import NotFoundPage from './pages/NotFoundPage';
import ReportsPage from './pages/ReportsPage';
import ScanStockPage from './pages/ScanStockPage';
import SecurityPage from './pages/SecurityPage';
import StockAdjustmentsPage from './pages/StockAdjustmentsPage';
import StockMovementPage from './pages/StockMovementPage';
import StockTransfersPage from './pages/StockTransfersPage';
import { createAppTheme } from './theme';
import { ADMIN_TIER } from './roles';

// Where a signed-in role lands when it opens a route it may not use. Inventory
// Staff have no dashboard (it is a money/analytics surface), so they land on
// the inventory levels page instead — redirecting them to "/" would loop.
function homeFor(role) {
  return role === 'staff' ? '/inventory' : '/';
}

// Role-based route guard: modules a role may not use redirect that account to
// its own home instead of rendering a page its token can't use. The backend
// enforces the same split, so this is defense in depth, not the only gate.
function RequireRole({ roles, children }) {
  const current = getCurrentUser();
  if (!current) {
    return <Navigate to="/" replace />;
  }
  if (!roles.includes(current.role)) {
    return <Navigate to={homeFor(current.role)} replace />;
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
        {/* Money + business analytics: admin tier only (staff land on /inventory). */}
        <Route path="/" element={<RequireRole roles={ADMIN_TIER}><DashboardPage user={user} onLogout={handleLogout} /></RequireRole>} />
        <Route path="/products" element={<RequireRole roles={ADMIN_TIER}><ProductsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/inventory" element={<InventoryPage onLogout={handleLogout} />} />
        <Route path="/scan-stock" element={<ScanStockPage onLogout={handleLogout} />} />
        <Route path="/stock-movement" element={<StockMovementPage onLogout={handleLogout} />} />
        <Route path="/stock-adjustments" element={<StockAdjustmentsPage onLogout={handleLogout} />} />
        <Route path="/stock-transfers" element={<StockTransfersPage onLogout={handleLogout} />} />
        <Route path="/approvals" element={<RequireRole roles={ADMIN_TIER}><ApprovalsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/order-inquiries" element={<RequireRole roles={ADMIN_TIER}><OrderInquiriesPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/locations" element={<RequireRole roles={ADMIN_TIER}><LocationsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/optimization" element={<RequireRole roles={ADMIN_TIER}><OptimizationPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/reports" element={<RequireRole roles={ADMIN_TIER}><ReportsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/security" element={<RequireRole roles={ADMIN_TIER}><SecurityPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/audit-trail" element={<RequireRole roles={ADMIN_TIER}><AuditTrailPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="*" element={<NotFoundPage />} />
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
