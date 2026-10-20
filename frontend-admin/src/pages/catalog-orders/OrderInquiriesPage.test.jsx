import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import OrderInquiriesPage from './OrderInquiriesPage';
import { createAppTheme } from '../../theme';
import { apiGet, apiPut } from '../../api';

// The panel's demands about REJECTIONS and CANCELLATIONS are only real if the
// console enforces them, so these tests lock the screen behaviour:
//
//   - a rejection cannot be confirmed without a reason, and the reason that is
//     typed is what gets sent (the server refuses a bare rejection too)
//   - the reason is READABLE afterwards, on the row and on a cancelled order
//   - the fulfilment preference is visible, because it decides whether the
//     address next to it matters
//
// A test that only checked "the page renders" would pass with a Confirm button
// that fires a reasonless rejection straight into a 400.

vi.mock('../../api', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ORDERS = [
  {
    id: 1,
    customer_name: 'Ana Reyes',
    customer_email: 'ana@example.com',
    products_detail: [{ name: 'Espresso Beans', qty: 2, price: 350 }],
    estimated_cost: 700,
    payment_method: 'cod',
    payment_status: 'unpaid',
    delivery_address: '12 Mabini St',
    fulfillment_method: 'courier',
    status: 'pending',
    status_history: JSON.stringify([{ status: 'pending', at: '2026-10-01T00:00:00.000Z' }]),
    created_at: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 2,
    customer_name: 'Ben Cruz',
    customer_email: 'ben@example.com',
    products_detail: [{ name: 'Oat Milk', qty: 6, price: 120 }],
    estimated_cost: 720,
    payment_method: 'cod',
    payment_status: 'unpaid',
    delivery_address: null,
    fulfillment_method: 'pickup',
    status: 'rejected',
    rejection_reason: 'Oat Milk is out of stock until next week.',
    status_history: JSON.stringify([{ status: 'pending', at: '2026-10-01T00:00:00.000Z' }, { status: 'rejected', at: '2026-10-02T00:00:00.000Z', by: 1, reason: 'Oat Milk is out of stock until next week.' }]),
    created_at: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 3,
    customer_name: 'Cara Lim',
    customer_email: 'cara@example.com',
    products_detail: [{ name: 'Paper Cups', qty: 1, price: 300 }],
    estimated_cost: 300,
    payment_method: 'cod',
    payment_status: 'unpaid',
    delivery_address: null,
    fulfillment_method: 'pickup',
    status: 'cancelled',
    cancellation_reason: 'Ordered the wrong pack size.',
    cancelled_at: '2026-10-03T00:00:00.000Z',
    status_history: JSON.stringify([{ status: 'pending', at: '2026-10-01T00:00:00.000Z' }, { status: 'cancelled', at: '2026-10-03T00:00:00.000Z' }]),
    created_at: '2026-10-01T00:00:00.000Z',
  },
];

function renderPage() {
  // Any endpoint the layout probes that is not the inquiry list answers with an
  // empty payload — this suite is about one page, not about its chrome.
  apiGet.mockImplementation((path) =>
    Promise.resolve(String(path).startsWith('/api/order-inquiries') ? ORDERS : []),
  );
  apiPut.mockResolvedValue({ ok: true, message: 'Inquiry rejected' });
  return render(
    <MemoryRouter>
      <ThemeProvider theme={createAppTheme()}>
        <OrderInquiriesPage onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('a rejection cannot be confirmed without a reason, and the typed reason is sent', async () => {
  renderPage();
  await screen.findByText('Ana Reyes');

  const row = screen.getByText('Ana Reyes').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /reject/i }));

  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: /confirm/i });
  // Nothing may be sent until a reason exists — the server would 400 anyway.
  expect(confirm.disabled).toBe(true);
  expect(apiPut).not.toHaveBeenCalled();

  fireEvent.change(within(dialog).getByLabelText(/why is this inquiry being rejected/i), {
    target: { value: 'Supplier moved the delivery to November.' },
  });
  expect(within(dialog).getByRole('button', { name: /confirm/i }).disabled).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

  await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
  expect(apiPut).toHaveBeenCalledWith('/api/order-inquiries/1', {
    status: 'rejected',
    rejection_reason: 'Supplier moved the delivery to November.',
  });
});

test('whitespace is not a reason', async () => {
  renderPage();
  await screen.findByText('Ana Reyes');
  const row = screen.getByText('Ana Reyes').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /reject/i }));

  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/why is this inquiry being rejected/i), {
    target: { value: '   ' },
  });
  expect(within(dialog).getByRole('button', { name: /confirm/i }).disabled).toBe(true);
});

test('the stored rejection reason is readable on the row without opening Details', async () => {
  renderPage();
  expect(await screen.findByText('Oat Milk is out of stock until next week.')).toBeInTheDocument();
});

test('a cancelled inquiry reads as a cancellation, not as a rejection', async () => {
  renderPage();
  await screen.findByText('Cara Lim');
  expect(screen.getByText('Cancelled by customer')).toBeInTheDocument();
  expect(screen.getByText('Ordered the wrong pack size.')).toBeInTheDocument();
  // The generic "Rejected" fallback must not swallow a cancellation.
  expect(screen.getAllByText('Rejected').length).toBeLessThan(3);
});

test('the fulfilment preference is visible per order', async () => {
  renderPage();
  await screen.findByText('Ana Reyes');
  const courierRow = screen.getByText('Ana Reyes').closest('tr');
  const pickupRow = screen.getByText('Ben Cruz').closest('tr');
  expect(within(courierRow).getByText('COURIER')).toBeInTheDocument();
  expect(within(pickupRow).getByText('PICKUP')).toBeInTheDocument();
});

test('an approved inquiry offers fulfilment and rejection, not an approve button', async () => {
  apiGet.mockImplementation((path) =>
    Promise.resolve(
      String(path).startsWith('/api/order-inquiries')
        ? [{ ...ORDERS[0], id: 9, status: 'approved', status_history: JSON.stringify([{ status: 'pending', at: '2026-10-01T00:00:00.000Z' }, { status: 'approved', at: '2026-10-02T00:00:00.000Z' }]) }]
        : [],
    ),
  );
  render(
    <MemoryRouter>
      <ThemeProvider theme={createAppTheme()}>
        <OrderInquiriesPage onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  const row = (await screen.findByText('Ana Reyes')).closest('tr');
  expect(within(row).getByRole('button', { name: /mark fulfilled/i })).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: /^approve$/i })).toBeNull();
});
