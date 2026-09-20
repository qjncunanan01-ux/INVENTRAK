import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import ReportsPage from './ReportsPage';
import { createAppTheme } from '../theme';
import { apiGet } from '../api';

// Regression for the blank-paper print bug: "Print / Save PDF" called
// window.print() while the global print CSS hid every element except
// #qr-tag-sheet — so the report itself never appeared on paper. The page must
// mark its printable region (data-print-root) and print THAT, not the window.
let printSpy;
beforeEach(() => {
  printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  printSpy.mockRestore();
});

vi.mock('../api', () => ({
  apiGet: vi.fn(),
  getCurrentUser: () => ({ role: 'admin' }),
}));

// jsdom lacks matchMedia (MUI useMediaQuery).
beforeAll(() => {
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
});

const THEME = createAppTheme();

const REPORT = {
  generated_at: '2026-09-21T08:00:00Z',
  days: 14,
  summary: {
    total_products: 204,
    total_stock: 9999,
    total_sales: 123456.75,
    transactions: 42,
    customers_served: 8,
    customers_paid: 6,
    pending_approvals: 3,
  },
  orderStatusSummary: { pending: 2, approved: 1, rejected: 0, fulfilled: 1, delivered: 0 },
  dailySales: [{ date: '2026-09-20', transactions: 3, value: 1000 }],
  stockByLocation: [{ location: 'Showroom', total: 500 }],
  lowStock: [{ id: 1, name: 'MATCHA POWDER', total: 12 }],
  fastMovers: [{ name: 'Torani Syrup', qty_sold: 30, value: 9000 }],
  slowMovers: [],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={THEME}>
        <ReportsPage onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

test('marks its printable region with data-print-root and prints that element', async() => {
  apiGet.mockResolvedValue(REPORT);
  renderPage();

  await waitFor(() => expect(screen.getByText('Management report')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('204')).toBeTruthy());

  fireEvent.click(screen.getByRole('button', { name: /Print \/ Save PDF/i }));

  // The report subtree must be the marked printable region — the mechanism
  // the global print CSS uses to reveal it. This is the assertion that fails
  // if the page ever reverts to bare window.print() with no printable region.
  const marked = document.querySelectorAll('[data-print-root]');
  expect(marked.length).toBe(1);
  expect(marked[0].textContent).toContain('Daily sales value');
  expect(marked[0].textContent).toContain('MATCHA POWDER');
  expect(printSpy).toHaveBeenCalledTimes(1);

  // Marker cleared after the print finishes (afterprint fires synchronously
  // in the mock), so a cancelled print cannot leak print state.
  fireEvent(window, new Event('afterprint'));
  expect(document.querySelectorAll('[data-print-root]').length).toBe(0);
});

test('data figures render so the paper has content to show', async() => {
  apiGet.mockResolvedValue(REPORT);
  renderPage();

  await waitFor(() => expect(screen.getByText('MATCHA POWDER')).toBeTruthy());
  expect(screen.getByText('Total products')).toBeTruthy();
  expect(screen.getByText('Available stocks per location')).toBeTruthy();
  expect(screen.getByText('Order status summary')).toBeTruthy();
  expect(screen.getByText('Fast-moving products')).toBeTruthy();
});
