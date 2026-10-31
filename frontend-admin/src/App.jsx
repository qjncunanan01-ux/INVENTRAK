import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { clearCurrentUser, clearToken, getCurrentUser, getMe, getToken, logout as apiLogout, setCurrentUser } from './api';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { MotionConfig } from 'framer-motion';
// Pages are grouped into the same sections the sidebar uses (see
// pages/layout/AdminLayout.jsx NAV_SECTIONS): overview · inventory ·
// stock-control · catalog-orders · insights · governance · account, plus
// auth (login) and layout (the shell). Keep a page next to its section peers.
import DashboardPage from './pages/overview/DashboardPage';
import InventoryPage from './pages/inventory/InventoryPage';
import ReconciliationPage from './pages/inventory/ReconciliationPage';
import StocktakePage from './pages/inventory/StocktakePage';
import LocationsPage from './pages/inventory/LocationsPage';
import TillPage from './pages/stock-control/TillPage';
import StockMovementPage from './pages/stock-control/StockMovementPage';
import StockAdjustmentsPage from './pages/stock-control/StockAdjustmentsPage';
import StockTransfersPage from './pages/stock-control/StockTransfersPage';
import ProductsPage from './pages/catalog-orders/ProductsPage';
import ScanStockPage from './pages/catalog-orders/ScanStockPage';
import OrderInquiriesPage from './pages/catalog-orders/OrderInquiriesPage';
import PaymentsPage from './pages/catalog-orders/PaymentsPage';
import UnitConversionsPage from './pages/catalog-orders/UnitConversionsPage';
import BackOrdersPage from './pages/catalog-orders/BackOrdersPage';
import NotificationsPage from './pages/governance/NotificationsPage';
import OptimizationPage from './pages/insights/OptimizationPage';
import ReportsPage from './pages/insights/ReportsPage';
import ApprovalsPage from './pages/governance/ApprovalsPage';
import AuditTrailPage from './pages/governance/AuditTrailPage';
import BackupPage from './pages/governance/BackupPage';
import SettingsPage from './pages/governance/SettingsPage';
import SecurityPage from './pages/account/SecurityPage';
import LoginPage from './pages/auth/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import { createAppTheme } from './theme';
import { ADMIN_TIER, MANAGEMENT_TIER } from './roles';

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
        {/* Dashboard: daily operations for Admin; additional executive metrics
            are already hidden there unless the role is Owner/Super Admin. */}
        <Route path="/" element={<RequireRole roles={ADMIN_TIER}><DashboardPage user={user} onLogout={handleLogout} /></RequireRole>} />
        <Route path="/products" element={<RequireRole roles={ADMIN_TIER}><ProductsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/inventory" element={<InventoryPage onLogout={handleLogout} />} />
        <Route path="/reconciliation" element={<ReconciliationPage onLogout={handleLogout} />} />
        {/* GET /api/stocktake is adminOnly on both backends (it reports which
            shelves are overdue and for how long), so the route is admin-tier —
            a staff link here would be a button that always 403s. */}
        <Route path="/stocktake" element={<RequireRole roles={ADMIN_TIER}><StocktakePage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/scan-stock" element={<ScanStockPage onLogout={handleLogout} />} />
        <Route path="/till" element={<RequireRole roles={ADMIN_TIER}><TillPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/stock-movement" element={<StockMovementPage onLogout={handleLogout} />} />
        <Route path="/stock-adjustments" element={<StockAdjustmentsPage onLogout={handleLogout} />} />
        <Route path="/stock-transfers" element={<StockTransfersPage onLogout={handleLogout} />} />
        <Route path="/approvals" element={<RequireRole roles={ADMIN_TIER}><ApprovalsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/order-inquiries" element={<RequireRole roles={ADMIN_TIER}><OrderInquiriesPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/payments" element={<RequireRole roles={ADMIN_TIER}><PaymentsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/back-orders" element={<RequireRole roles={ADMIN_TIER}><BackOrdersPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/unit-conversions" element={<RequireRole roles={ADMIN_TIER}><UnitConversionsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/locations" element={<RequireRole roles={ADMIN_TIER}><LocationsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/optimization" element={<RequireRole roles={MANAGEMENT_TIER}><OptimizationPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/reports" element={<RequireRole roles={MANAGEMENT_TIER}><ReportsPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/security" element={<RequireRole roles={ADMIN_TIER}><SecurityPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/audit-trail" element={<RequireRole roles={MANAGEMENT_TIER}><AuditTrailPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/notifications" element={<RequireRole roles={ADMIN_TIER}><NotificationsPage onLogout={handleLogout} /></RequireRole>} />
        {/* Backups contain full database copies and restore overwrites data. */}
        <Route path="/backup" element={<RequireRole roles={MANAGEMENT_TIER}><BackupPage onLogout={handleLogout} /></RequireRole>} />
        <Route path="/settings" element={<RequireRole roles={MANAGEMENT_TIER}><SettingsPage user={user} onLogout={handleLogout} /></RequireRole>} />
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
      {/* reducedMotion="user" makes every framer-motion animation in the app
          respect prefers-reduced-motion: transform/opacity entrance effects
          (StatCard, PageTransition, the card wrappers) jump straight to their
          final state instead of animating. That is the accessible behaviour for
          a user who asked for it, and it removes the last source of a
          half-animation frame — a screenshot taken mid-fade is not a stable
          baseline. One setting at the root beats a guard in each component. */}
      <MotionConfig reducedMotion="user">
        <AppRoutes />
      </MotionConfig>
    </ThemeProvider>
  );
}

export default App;
