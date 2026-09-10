import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import OptimizationPage from './OptimizationPage';
import { createAppTheme } from '../theme';
import { apiGet } from '../api';

// Guards the FSN analysis section: the page must fetch the real
// /api/optimization/fsn endpoint (honoring the ?window= param), render all
// three class chips with counts, and surface Non-moving rows first so dead
// stock is actionable. Regression net for the FSN feature.
vi.mock('../api', () => ({
  apiGet: vi.fn(),
  getCurrentUser: () => ({ role: 'admin' }),
}));

// jsdom has no matchMedia (MUI useMediaQuery) and no ResizeObserver.
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

const abcData = [
  { id: 1, name: 'Fast Product', value: 5000, classification: 'A' },
  { id: 2, name: 'Dead Product', value: 100, classification: 'C' },
];

const fsnData = [
  // Backend sorts Non-moving first — the page must preserve that order.
  { id: 2, name: 'Dead Product', classification: 'N', transactions: 0, frequencyDays: null, recencyDays: null, ratePerDay: 0, totalQty: 0, valueSold: 0, windowDays: 90 },
  { id: 1, name: 'Fast Product', classification: 'F', transactions: 12, frequencyDays: 7, recencyDays: 1, ratePerDay: 1.2, totalQty: 108, valueSold: 540, windowDays: 90 },
];

const products = [
  { id: 1, name: 'Fast Product', price: 100 },
  { id: 2, name: 'Dead Product', price: 50 },
];

function mockResponses() {
  apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/optimization/fsn')) {
      const windowDays = new URL(url, 'http://localhost').searchParams.get('window');
      return Promise.resolve(fsnData.map((r) => ({ ...r, windowDays: Number(windowDays) || 90 })));
    }
    const byUrl = {
      '/api/optimization/abc': abcData,
      '/api/products': products,
      '/api/optimization/1': { EOQ: 10, ROP: 20, safetyStock: 5, annualDemand: 100, turnoverRatio: 1.5, avgInventory: 66 },
      '/api/optimization/2': { EOQ: 8, ROP: 12, safetyStock: 3, annualDemand: 60, turnoverRatio: 0.9, avgInventory: 67 },
    };
    if (byUrl[url] !== undefined) return Promise.resolve(byUrl[url]);
    return Promise.resolve([]);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/optimization']}>
      <ThemeProvider theme={createAppTheme()}>
        <OptimizationPage onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

// The FSN table is the only one whose header row contains "Class".
function getFsnTable() {
  const classHeader = screen.getByText('Class', { selector: 'th' });
  return classHeader.closest('table');
}

describe('OptimizationPage FSN analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    polyfillDom();
  });

  test('fetches /api/optimization/fsn with the default 90-day window', async () => {
    mockResponses();
    renderPage();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/optimization/fsn?window=90');
    });
  });

  test('renders class chips with counts and both FSN rows (Non-moving first)', async () => {
    mockResponses();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fast-moving: 1')).toBeInTheDocument();
    });
    expect(screen.getByText('Slow-moving: 0')).toBeInTheDocument();
    expect(screen.getByText('Non-moving: 1')).toBeInTheDocument();

    // Names appear in BOTH the ABC and FSN tables — scope to the FSN table.
    const table = getFsnTable();
    const rows = within(table).getAllByRole('row');
    const deadRow = rows.find((r) => r.textContent.includes('Dead Product'));
    const fastRow = rows.find((r) => r.textContent.includes('Fast Product'));
    expect(deadRow).toBeTruthy();
    expect(fastRow).toBeTruthy();
    // Non-moving dead stock must appear BEFORE the fast mover.
    expect(rows.indexOf(deadRow)).toBeLessThan(rows.indexOf(fastRow));

    // Movement metrics render inside the FSN table.
    expect(within(table).getByText('12')).toBeInTheDocument(); // txns of Fast Product
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0); // null metrics for N rows
  });

  test('changing the analysis window re-fetches with the new ?window= value', async () => {
    mockResponses();
    renderPage();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/optimization/fsn?window=90');
    });

    // The window Select's accessible name comes from its label.
    const combo = screen.getByRole('combobox', { name: 'Analysis window' });
    fireEvent.mouseDown(combo);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Last 30 days' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('option', { name: 'Last 30 days' }));

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/optimization/fsn?window=30');
    });
  });

  test('search filters both the ABC and FSN tables consistently', async () => {
    mockResponses();
    renderPage();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/optimization/fsn?window=90');
    });

    fireEvent.change(screen.getByLabelText(/Search products/), { target: { value: 'Dead' } });

    // "Dead Product" survives in both tables; "Fast Product" is filtered out
    // of both. Scope assertions to the tables: the EOQ product picker also
    // renders product names and is not affected by the search filter.
    await waitFor(() => {
      const classHeader = screen.getByText('Class', { selector: 'th' });
      const fsnTable = classHeader.closest('table');
      expect(within(fsnTable).getAllByText('Dead Product').length).toBeGreaterThan(0);
      expect(within(fsnTable).queryByText('Fast Product')).not.toBeInTheDocument();
    });
    const abcHeader = screen.getByText('Value', { selector: 'th' });
    const abcTable = abcHeader.closest('table');
    expect(within(abcTable).getAllByText('Dead Product').length).toBeGreaterThan(0);
    expect(within(abcTable).queryByText('Fast Product')).not.toBeInTheDocument();
  });
});
