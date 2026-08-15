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
vi.mock('../api', () => ({
  apiGet: vi.fn(),
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
});
