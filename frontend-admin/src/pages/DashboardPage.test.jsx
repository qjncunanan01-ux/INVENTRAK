import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import DashboardPage from './DashboardPage';
import { createAppTheme } from '../theme';
import { apiGet } from '../api';

// The dashboard's stat cards and charts must never depend on a wrong endpoint
// again. Regression for the 404 bug where DashboardPage called the
// nonexistent /api/inquiries and the Order Status / Pending Inquiries cards
// silently showed 0.
let mockRole = 'admin';
vi.mock('../api', () => ({
  apiGet: vi.fn(),
  // AdminLayout reads the signed-in role to filter the sidebar; the dashboard
  // test renders as an admin so the full nav is expected. Tests can flip this
  // to 'staff' to exercise the role-gated fallbacks.
  getCurrentUser: () => ({ role: mockRole }),
}));

// jsdom has no matchMedia (MUI useMediaQuery) and no ResizeObserver
// (recharts' ResponsiveContainer). Provide inert stubs so the page mounts.
function polyfillDom() {
  window.matchMedia = (query) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

const pendingInquiry = { id: 1, status: 'pending', customer_name: 'Jerico', total: 1200 };
const approvedInquiry = { id: 2, status: 'approved', customer_name: 'Rome', total: 800 };

function mockResponses() {
  apiGet.mockImplementation((url) => {
    const byUrl = {
      '/api/analytics/summary': {},
      '/api/inventory': { items: [], locations: [] },
      '/api/products': [],
      '/api/locations': [],
      '/api/order-inquiries': [pendingInquiry, approvedInquiry],
      '/api/sales': [],
      '/api/stock-movements': [],
      '/api/alerts': [],
    };
    return Promise.resolve(byUrl[url] !== undefined ? byUrl[url] : []);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider theme={createAppTheme()}>
        <DashboardPage user={{ username: 'admin', role: 'admin' }} onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('DashboardPage data wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    polyfillDom();
  });

  test('fetches the real order-inquiries endpoint, never the stale /api/inquiries', async () => {
    mockResponses();
    renderPage();

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/order-inquiries');
    });
    // The exact 404 that zeroed the cards must never come back.
    expect(apiGet).not.toHaveBeenCalledWith('/api/inquiries');
    // The Active Alerts card's modal is wired to the real alert list (never
    // stock movements masquerading as alerts).
    expect(apiGet).toHaveBeenCalledWith('/api/alerts');
  });

  test('renders non-zero pending counts derived from the inquiries payload', async () => {
    mockResponses();
    renderPage();

    // Pending Inquiries card (count of status === 'pending') and the Order
    // Status card ("1 Pending").
    await waitFor(() => {
      expect(screen.getByText('Pending Inquiries')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('1 Pending')).toBeInTheDocument();
    });
  });

  test('Total Registered Customers card renders the account base from the summary', async () => {
    // Executive role (owner) — the account base is executive-only, so render
    // as owner to see the raw count. The card shows it verbatim (0 stays 0 —
    // never a payer-name fallback).
    mockRole = 'owner';
    apiGet.mockImplementation((url) => {
      const byUrl = {
        '/api/analytics/summary': { customersRegistered: 12, customersServed: 5 },
        '/api/inventory': { items: [], locations: [] },
        '/api/products': [],
        '/api/locations': [],
        '/api/order-inquiries': [],
        '/api/sales': [],
        '/api/stock-movements': [],
        '/api/alerts': [],
      };
      return Promise.resolve(byUrl[url] !== undefined ? byUrl[url] : []);
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Total Registered Customers')).toBeInTheDocument();
    });
    // The counter settles to the exact value once the spring completes.
    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test('Total Registered Customers is masked for a role without executive oversight', async () => {
    mockRole = 'admin'; // admin tier: NOT executive → account base hidden
    apiGet.mockImplementation((url) => {
      const byUrl = {
        '/api/analytics/summary': { customersRegistered: 12, customersServed: 5 },
        '/api/inventory': { items: [], locations: [] },
        '/api/products': [],
        '/api/locations': [],
        '/api/order-inquiries': [],
        '/api/sales': [],
        '/api/stock-movements': [],
        '/api/alerts': [],
      };
      return Promise.resolve(byUrl[url] !== undefined ? byUrl[url] : []);
    });
    renderPage();

    // The value must never render raw for non-executives; the card shows the
    // masked placeholder instead (the label text embeds the lock emoji).
    await waitFor(() => {
      expect(screen.getByText('Total Registered Customers')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Executive Only/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });

  // Money is role-gated (see src/roles.js): a role WITHOUT revenue visibility
  // sees the masked placeholder on every peso surface instead of the amount,
  // and the two money charts collapse to "Hidden for your role". Inventory
  // Staff cannot reach this page in the app, so this is the last line of
  // defense — and the regression test for the masking itself.
  test('money surfaces are masked for a role without revenue visibility', async () => {
    mockRole = 'staff';
    const thisMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 7);
    apiGet.mockImplementation((url) => {
      const byUrl = {
        '/api/analytics/summary': {
          pendingInquiries: 3,
          totalSales: 999999,
          customersServed: 3,
          activeAlerts: 7,
          fastMovingProducts: [{ name: 'Caramel Syrup', qty_sold: 40 }],
          slowMovingProducts: [{ name: 'Old Stock', qty_sold: 1 }],
        },
        '/api/inventory': { items: [], locations: [] },
        '/api/products': [],
        '/api/locations': [],
        '/api/order-inquiries': [],
        '/api/sales': null, // 403 for staff — rejected path
        '/api/stock-movements': [],
        '/api/alerts': [],
        '/api/reports?days=90': {
          dailySales: [
            { date: `${thisMonth}-02`, transactions: 5, value: 12340 },
            { date: `${prevMonth}-15`, transactions: 2, value: 8000 },
          ],
        },
      };
      if (byUrl[url] === null) return Promise.reject(new Error('403 Forbidden'));
      return Promise.resolve(byUrl[url] !== undefined ? byUrl[url] : []);
    });
    renderPage();

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/reports?days=90');
    });
    // SALES THIS MONTH card derives 12,340 from this month's daily rows
    // (labels are CSS-uppercased, so query the title-case DOM text).
    // Generous timeout: under parallel vitest runs the async fetch chain
    // sometimes exceeds the 1s default, flaking the suite.
    await waitFor(() => {
      expect(screen.getByText('Sales This Month')).toBeInTheDocument();
      // Both peso KPI cards show the mask, never the amount.
      expect(screen.getAllByText(/🔒/i).length).toBeGreaterThanOrEqual(2);
    }, { timeout: 4000 });
    expect(screen.queryByText('P12,340')).not.toBeInTheDocument();
    // The revenue-bearing charts are replaced by an explicit placeholder.
    expect(screen.getAllByText(/Executive Access Required/i).length).toBeGreaterThanOrEqual(1);
    // Fast/slow movers fall back to the public summary's ranked lists (the
    // raw ledger is role-blocked for staff). recharts labels don't render in
    // jsdom's 0x0 ResponsiveContainer, so assert the empty-state placeholder
    // is gone instead — before the fix, staff saw "No sales data yet".
    await waitFor(() => {
      expect(screen.queryByText('No sales data yet')).not.toBeInTheDocument();
    });
    // Active Alerts falls back to the public summary count too (the alert
    // list endpoint is admin-only) — before the fix, staff saw 0.
    await waitFor(() => {
      expect(screen.getByText('Active Alerts')).toBeInTheDocument();
      expect(screen.getByText('7')).toBeInTheDocument();
    });
    mockRole = 'admin';
  });
});
