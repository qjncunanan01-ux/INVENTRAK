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

  // Staff cannot read /api/sales (403 by role design), so the dashboard must
  // fall back to the staff-allowed /api/reports aggregate — otherwise SALES
  // THIS MONTH, TRANSACTIONS THIS MONTH, and the movers/chart show zeros.
  // Regression for the staff-zero bug found during the full-ledger seed.
  test('staff dashboard derives monthly sales from /api/reports, not zeros', async () => {
    mockRole = 'staff';
    const thisMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 7);
    apiGet.mockImplementation((url) => {
      const byUrl = {
        '/api/analytics/summary': {
          pendingInquiries: 3,
          totalSales: 999999,
          customersServed: 3,
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
    await waitFor(() => {
      expect(screen.getByText('Sales This Month')).toBeInTheDocument();
      expect(screen.getByText('P12,340')).toBeInTheDocument();
    });
    // Fast/slow movers fall back to the public summary's ranked lists (the
    // raw ledger is role-blocked for staff). recharts labels don't render in
    // jsdom's 0x0 ResponsiveContainer, so assert the empty-state placeholder
    // is gone instead — before the fix, staff saw "No sales data yet".
    await waitFor(() => {
      expect(screen.queryByText('No sales data yet')).not.toBeInTheDocument();
    });
    mockRole = 'admin';
  });
});
