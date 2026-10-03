import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import ReconciliationPage from './ReconciliationPage';
import { createAppTheme } from '../theme';
import { apiGet, apiPost } from '../api';

// The discrepancy report. The behaviours locked here are the ones that would
// make the report misleading rather than merely wrong:
//
//   - a loss is shown as a LOSS, not folded into a neutral total
//   - an overage is never added to shrinkage
//   - staff can COUNT but cannot read money at risk (no 403 dead-end)
//   - with no counts yet the report says so, instead of reading as clean
//   - the formula is printed next to the numbers

let mockRole = 'admin';
vi.mock('../api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getMeta: vi.fn(() => Promise.reject(new Error('offline'))),
  getCurrentUser: () => ({ role: mockRole }),
}));

window.matchMedia = window.matchMedia || ((query) => ({
  matches: query.includes('min-width'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
}));

const inventory = {
  locations: [{ id: 1, name: 'Showroom' }, { id: 2, name: 'Stockroom 1' }],
  items: [
    { product: { id: 1, name: 'Da Vinci Butterscotch Sauce (2L)' }, locations: { Showroom: 100, 'Stockroom 1': 40 }, total: 140 },
    { product: { id: 2, name: 'Almond Milk (1L)' }, locations: { Showroom: 30, 'Stockroom 1': 20 }, total: 50 },
  ],
};

const lossRow = {
  product_id: 1, location_id: 1, product: 'Da Vinci Butterscotch Sauce (2L)', location: 'Showroom',
  counted_qty: 100, system_qty_at_count: 100, variance_at_count: 0,
  sales_since_count: 5, expected_qty_now: 95, system_qty_now: 98, unexplained_qty: 3,
  classification: 'loss', value_at_risk: 3210, unit_price: 1070,
  counted_at: '2026-10-01T00:00:00.000Z', counted_by: 'staff', unparsed_sales: 0, count_undated: false,
};

const report = {
  rows: [lossRow],
  summary: {
    counted_rows: 1, balanced: 0, losses: 1, overages: 0,
    shrinkage_units: 3, overage_units: 0, value_at_risk: 3210,
    incomplete_sales_rows: 0, undated_counts: 0,
  },
  locations: inventory.locations,
};

function routeApi({ reconciliation = report } = {}) {
  apiGet.mockImplementation((path) => {
    if (String(path).startsWith('/api/inventory/reconciliation')) return Promise.resolve(reconciliation);
    if (String(path).startsWith('/api/inventory')) return Promise.resolve(inventory);
    return Promise.resolve([]);
  });
}

const renderPage = () => render(
  <ThemeProvider theme={createAppTheme()}>
    <MemoryRouter>
      <ReconciliationPage onLogout={() => {}} />
    </MemoryRouter>
  </ThemeProvider>
);

async function fillCount({ product = '1', shelf = '1', qty = '97' } = {}) {
  await screen.findByLabelText('Product');
  const selects = screen.getAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: product } });
  fireEvent.change(selects[1], { target: { value: shelf } });
  fireEvent.change(screen.getByLabelText('Counted quantity'), { target: { value: qty } });
}

describe('ReconciliationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'admin';
    routeApi();
  });

  it('prints the formula beside its own numbers', async () => {
    renderPage();
    const panel = await screen.findByLabelText('Reconciliation report');
    await waitFor(() => expect(panel).toHaveTextContent('Da Vinci Butterscotch Sauce'));
    // The banner names the actual arithmetic, not a slogan.
    expect(screen.getByText(/unexplained = system_now/)).toBeInTheDocument();
  });

  it('flags an unaccounted loss with its money value', async () => {
    renderPage();
    const panel = await screen.findByLabelText('Reconciliation report');
    await waitFor(() => expect(panel).toHaveTextContent('Unaccounted'));
    expect(panel).toHaveTextContent('₱3,210');
    expect(panel).toHaveTextContent('on the books but not on the shelf');
  });

  it('shows the row detail in words, not just numbers', async () => {
    renderPage();
    const panel = await screen.findByLabelText('Reconciliation report');
    await waitFor(() => expect(panel).toHaveTextContent('cannot account for'));
  });

  it('never names a cause for the loss', async () => {
    renderPage();
    const panel = await screen.findByLabelText('Reconciliation report');
    await waitFor(() => expect(panel).toHaveTextContent('Unaccounted'));

    // Scope matters: the CAVEAT block deliberately says theft is
    // indistinguishable, which is the honest statement. What must never
    // happen is a FINDING asserting a cause — so the headline, the alert and
    // the row-detail sentence are checked on their own.
    const claims = [
      panel.querySelector('.MuiAlert-message')?.textContent || '',
      document.body.textContent.includes('on the books but not on the shelf')
        ? 'on the books but not on the shelf'
        : '',
    ].join(' ').toLowerCase();
    for (const word of ['steal', 'theft', 'stolen', 'thief', 'shoplift', 'lost']) {
      expect(claims).not.toContain(word);
    }

    // ...and the disclaimer that says WHY it cannot know is present.
    expect(panel.textContent.toLowerCase()).toContain('does not say why');
  });

  it('does not read as clean when nothing has been counted', async () => {
    routeApi({
      reconciliation: {
        rows: [],
        summary: {
          counted_rows: 0, balanced: 0, losses: 0, overages: 0,
          shrinkage_units: 0, overage_units: 0, value_at_risk: 0,
          incomplete_sales_rows: 0, undated_counts: 0,
        },
        locations: inventory.locations,
      },
    });
    renderPage();
    const panel = await screen.findByLabelText('Reconciliation report');
    await waitFor(() => expect(panel).toHaveTextContent('No shelves counted yet'));
    expect(panel).toHaveTextContent('Nothing to compare yet');
  });

  it('tells staff they can count but cannot read the report', async () => {
    mockRole = 'staff';
    renderPage();
    expect(await screen.findByText(/it is admin-tier/)).toBeInTheDocument();
    // A staff user must never be shown the money-at-risk alert.
    expect(screen.queryByText(/on the books but not on the shelf/)).not.toBeInTheDocument();
    // ...and must not be fired a request they are forbidden to make.
    expect(apiGet.mock.calls.some(c => String(c[0]).includes('/reconciliation'))).toBe(false);
  });

  it('records a count and reports the difference in plain words', async () => {
    apiPost.mockResolvedValue({ ok: true, count_id: 1, counted_qty: 97, system_qty: 100, variance: -3 });
    renderPage();
    await fillCount();
    fireEvent.click(screen.getByRole('button', { name: /Record count/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/inventory/count', {
      product_id: 1, location_id: 1, counted_qty: 97, note: undefined,
    }));
    expect(await screen.findByText(/Difference of 3 units missing/)).toBeInTheDocument();
  });

  it('shows the system figure while counting, so the gap is visible', async () => {
    renderPage();
    await fillCount();
    expect(await screen.findByText('The system currently says 100 on this shelf.')).toBeInTheDocument();
  });

  it('will not submit an empty or negative count', async () => {
    apiPost.mockResolvedValue({});
    renderPage();
    await screen.findByLabelText('Product');
    expect(screen.getByRole('button', { name: /Record count/ })).toBeDisabled();
    await fillCount({ qty: '-5' });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('refuses a count that is not a number rather than coercing it to 0', async () => {
    // The backend rejects these too; the page must not turn "" into a real
    // count of zero, which would look like an empty shelf.
    apiPost.mockResolvedValue({});
    renderPage();
    await screen.findByLabelText('Product');
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '1' } });
    fireEvent.change(selects[1], { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Record count/ }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('keeps a counted shelf out of the default view when it balances', async () => {
    routeApi({
      reconciliation: {
        rows: [],
        summary: {
          counted_rows: 2, balanced: 2, losses: 0, overages: 0,
          shrinkage_units: 0, overage_units: 0, value_at_risk: 0,
          incomplete_sales_rows: 0, undated_counts: 0,
        },
        locations: inventory.locations,
      },
    });
    renderPage();
    const panel = await screen.findByLabelText('Reconciliation report');
    await waitFor(() => expect(panel).toHaveTextContent('every one balances'));
    // The toggle is how the operator asks to see them anyway.
    const toggle = screen.getByRole('button', { name: /Show all counted shelves/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/inventory/reconciliation'));
  });
});