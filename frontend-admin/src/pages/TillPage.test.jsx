import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import TillPage from './TillPage';
import { createAppTheme } from '../theme';
import { apiGet, apiPost } from '../api';

// The till is the screen that makes the physical-store path DEMONSTRABLE, so
// these tests lock the three things a panel would look at:
//
//   - before the sale: the batch that is about to leave is named, in the same
//     FEFO order the server applies
//   - after the sale: the batch that ACTUALLY left, read back from the server's
//     consumption manifest
//   - the guard: a sale bigger than the shelf warns before it is sent, and the
//     recorded total comes from the server, never from the form
//
// Regression guard for a bug this screen was built to prevent: a receipt that
// shows a total typed into the form rather than the one the server computed
// from the catalog.

vi.mock('../api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getMeta: vi.fn(() => Promise.reject(new Error('offline'))),
  getCurrentUser: () => ({ role: 'admin' }),
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

const products = [
  { id: 1, name: 'Da Vinci Butterscotch Sauce (2L)', price: 1070, category: 'Sauce' },
  { id: 2, name: 'Almond Milk (1L)', price: 180, category: 'Milk' },
];
const locations = [
  { id: 1, name: 'Showroom' },
  { id: 2, name: 'Stockroom 1' },
];

// Product 1 at location 1: an expiring batch and a fresh one, plus undated
// stock — so FEFO has something to actually choose between.
function lotsResponse() {
  return [
    { id: 11, product_id: 1, location_id: 1, qty: 4, expiry_date: '2026-11-01', received_at: '2026-01-05T00:00:00.000Z' },
    { id: 12, product_id: 1, location_id: 1, qty: 40, expiry_date: '2027-06-01', received_at: '2026-02-05T00:00:00.000Z' },
    { id: 13, product_id: 1, location_id: 1, qty: 30, expiry_date: null, received_at: '2026-03-05T00:00:00.000Z' },
  ];
}

const saleResponse = {
  ok: true,
  total: 3210,
  sale_id: 613,
  location_id: 1,
  location: 'Showroom',
  stock_remaining: 110,
  lots_consumed: [{ lot_id: 11, expiry_date: '2026-11-01', received_at: '2026-01-05T00:00:00.000Z', qty: 2 }],
  low_stock_alert: null,
};

function routeApi({ post } = {}) {
  apiGet.mockImplementation((path) => {
    if (path === '/api/products') return Promise.resolve(products);
    if (path === '/api/locations') return Promise.resolve(locations);
    if (String(path).startsWith('/api/stock-lots')) return Promise.resolve(lotsResponse());
    return Promise.resolve([]);
  });
  apiPost.mockImplementation(post || (() => Promise.resolve(saleResponse)));
}

const renderTill = () => render(
  <ThemeProvider theme={createAppTheme()}>
    <MemoryRouter>
      <TillPage onLogout={() => {}} />
    </MemoryRouter>
  </ThemeProvider>
);

// Type into the autocomplete to filter, pick the product, fill the rest.
// Typing rather than clicking the popup indicator also exercises the search
// half, which is what a busy counter actually uses.
async function fillForm({ qty = '2', product = 'Da Vinci', customer = '' } = {}) {
  const input = await screen.findByLabelText('Product');
  fireEvent.change(input, { target: { value: product } });
  const option = await screen.findByRole('option', { name: new RegExp(product) });
  fireEvent.click(option);
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: qty } });
  fireEvent.change(screen.getByLabelText('Sold from'), { target: { value: '1' } });
  if (customer) fireEvent.change(screen.getByLabelText(/Customer name/), { target: { value: customer } });
}

describe('TillPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeApi();
  });

  it('loads the catalog and the locations', async () => {
    renderTill();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/products'));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/locations'));
    const select = await screen.findByLabelText('Sold from');
    expect(within(select).getByText('Showroom')).toBeTruthy();
  });

  it('previews the expiring batch BEFORE the sale is recorded', async () => {
    // This is the feature. Without it FEFO is only provable by reading the
    // sort order in the source.
    renderTill();
    await fillForm({ qty: '2' });

    const preview = await screen.findByLabelText('Batch about to leave');
    expect(preview).toHaveTextContent('Lot #11');
    expect(preview).toHaveTextContent('2 units');
    expect(preview).toHaveTextContent('2026-11-01');
    // ...and NOT the fresh batch, which is what makes it an ordering claim.
    expect(preview).not.toHaveTextContent('Lot #12');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('says a bigger sale would span more than one batch', async () => {
    renderTill();
    await fillForm({ qty: '10' }); // more than lot 11's 4 units
    const preview = await screen.findByLabelText('Batch about to leave');
    expect(preview).toHaveTextContent('Lot #11');
    expect(preview).toHaveTextContent('more than one will be consumed');
  });

  it('warns when the sale is bigger than the shelf before it is sent', async () => {
    renderTill();
    await fillForm({ qty: '9999' });
    expect(await screen.findByText(/Only 74 on this shelf/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('records the sale and shows which lot was consumed', async () => {
    renderTill();
    await fillForm({ qty: '2', customer: 'Maria (walk-in)' });

    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/api/sales', {
      product_id: 1,
      qty: 2,
      location_id: 1,
      customer_name: 'Maria (walk-in)',
    });

    const receipt = await screen.findByLabelText('Sale receipt');
    await waitFor(() => expect(receipt).toHaveTextContent('3,210'));
    expect(receipt).toHaveTextContent('110 left on the shelf');
    expect(receipt).toHaveTextContent('Lot #11');
    expect(receipt).toHaveTextContent('2 units');
    expect(receipt).toHaveTextContent('2 units accounted for');
  });

  it('surfaces a low-stock alert the sale raised', async () => {
    routeApi({
      post: () => Promise.resolve({
        ...saleResponse,
        stock_remaining: 0,
        low_stock_alert: { threshold: 120, current_qty: 0, raised: true },
      }),
    });
    renderTill();
    await fillForm({ qty: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }));
    const receipt = await screen.findByLabelText('Sale receipt');
    await waitFor(() => expect(receipt).toHaveTextContent('Below the critical level: 0 left, reorder at 120.'));
  });

  it('labels overflow stock honestly instead of inventing a batch', async () => {
    routeApi({
      post: () => Promise.resolve({
        ...saleResponse,
        lots_consumed: [{ lot_id: null, expiry_date: null, received_at: null, qty: 2 }],
      }),
    });
    renderTill();
    await fillForm({ qty: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }));
    const receipt = await screen.findByLabelText('Sale receipt');
    await waitFor(() => expect(receipt).toHaveTextContent('Unbatched stock'));
    expect(receipt).not.toHaveTextContent('Lot #');
  });

  it('shows the server error and keeps the form when the sale is refused', async () => {
    routeApi({ post: () => Promise.reject(new Error('Insufficient stock at this location')) });
    renderTill();
    await fillForm({ qty: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }));
    expect(await screen.findByText('Insufficient stock at this location')).toBeTruthy();
    // Nothing was recorded, so no receipt is invented.
    expect(screen.getByLabelText('Sale receipt')).toHaveTextContent('Nothing recorded yet');
  });

  it('will not submit without a product, quantity and location', async () => {
    renderTill();
    await screen.findByLabelText('Product');
    const button = screen.getByRole('button', { name: /Record sale/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('sends no customer_name when the field is left blank', async () => {
    renderTill();
    await fillForm({ qty: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Record sale/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    // `undefined`, not '' — the backend treats a blank as "anonymous".
    expect(apiPost.mock.calls[0][1].customer_name).toBeUndefined();
  });
});