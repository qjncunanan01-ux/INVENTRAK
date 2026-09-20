import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import InventoryPage from './InventoryPage';
import { createAppTheme } from '../theme';
import { apiGet } from '../api';

// Best-before column + filter on the Inventory page. Regression suite for the
// dated-lot visibility: the page aggregates /api/stock-lots per product and
// must show the FEFO urgency chip next to the stock level — and the filter
// must narrow the rows without touching the other filters.

vi.mock('../api', () => ({
  apiGet: vi.fn(),
  getCurrentUser: () => ({ role: 'admin' }),
}));

// jsdom has no matchMedia (MUI useMediaQuery).
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

// ---- Date helpers: fixtures are computed relative to the real "today", so
// the day-counts the page derives are deterministic without fake timers.
// (Local date parts, NOT toISOString — that shifts a day in UTC+8.)
function iso(daysFromToday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const EXPIRED_DAYS = -7; // product 1's earliest lot
const SOON_DAYS = 18; // product 2's only lot

const inventory = {
  locations: ['Showroom', 'Stockroom 1', 'Stockroom 2'],
  items: [
    {
      product: { id: 1, name: 'Milklab Milk 1L', category: 'Milk' },
      locations: { Showroom: 10, 'Stockroom 1': 20, 'Stockroom 2': 5 },
      total: 35,
      critical_level: 120,
    },
    {
      product: { id: 2, name: 'Torani Vanilla Syrup', category: 'Syrup' },
      locations: { Showroom: 40, 'Stockroom 1': 60, 'Stockroom 2': 0 },
      total: 100,
      critical_level: 60,
    },
    {
      product: { id: 3, name: 'Beryls Compound', category: 'Chocolate' },
      locations: { Showroom: 25, 'Stockroom 1': 25, 'Stockroom 2': 25 },
      total: 75,
      critical_level: 32,
    },
  ],
};

// FEFO ledger: product 1 has an expired lot AND a later dated lot (earliest
// must win); product 2 expires soon; product 3 has no dated lots (undated).
const lots = [
  { id: 1, product_id: 1, product_name: 'Milklab Milk 1L', location_name: 'Stockroom 1', qty: 8, received_at: '2026-01-01', expiry_date: iso(EXPIRED_DAYS) },
  { id: 2, product_id: 1, product_name: 'Milklab Milk 1L', location_name: 'Stockroom 2', qty: 12, received_at: '2026-08-01', expiry_date: iso(45) },
  { id: 3, product_id: 2, product_name: 'Torani Vanilla Syrup', location_name: 'Showroom', qty: 6, received_at: '2026-06-01', expiry_date: iso(SOON_DAYS) },
];

function mockResponses() {
  apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/inventory')) return Promise.resolve(inventory);
    if (url.startsWith('/api/stock-lots')) return Promise.resolve(lots);
    return Promise.resolve([]);
  });
}

function renderPage() {
  const theme = createAppTheme();
  return render(
    <MemoryRouter initialEntries={['/inventory']}>
      <ThemeProvider theme={theme}>
        <InventoryPage onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

// The expiry chip hides its detail behind a hover tooltip — MUI renders it on
// mouseOver (same pattern as the OptimizationPage "Why?" badge tests).
function hoverChip(rowText) {
  const rows = screen.getAllByRole('row');
  const row = rows.find((r) => r.textContent.includes(rowText));
  expect(row).toBeTruthy();
  const chip = within(row).getByLabelText(new RegExp(`${rowText} best before`, 'i'));
  fireEvent.mouseOver(chip);
  return chip;
}

test('shows the nearest expiry per product with the urgency chip', async() => {
  mockResponses();
  renderPage();

  // Header exists — scoped to a table header cell (the filter label and its
  // outline legend share the same text).
  await waitFor(() => {
    const th = [...document.querySelectorAll('th')].find((el) => el.textContent.trim() === 'Best before');
    expect(th).toBeTruthy();
  });
  await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/stock-lots'));

  // Product 1: earliest lot (7 days ago) wins over its later dated lot →
  // "Expired 7d ago". The accessible name carries the evidence.
  const milk = screen.getByLabelText(new RegExp(`Milklab Milk 1L best before ${iso(EXPIRED_DAYS)} — Expired`, 'i'));
  expect(milk).toBeInTheDocument();

  // Product 2: 18 days out → "18d left".
  expect(screen.getByLabelText(new RegExp(`Torani Vanilla Syrup best before ${iso(SOON_DAYS)} — 18d left`, 'i'))).toBeInTheDocument();

  // Product 3: no dated lots → the em-dash placeholder.
  const rows = screen.getAllByRole('row');
  const berylsRow = rows.find((r) => within(r).queryByText('Beryls Compound'));
  expect(within(berylsRow).getByText('—')).toBeInTheDocument();
});

test('tooltip reveals lot qty, the dated date, and the FEFO note', async() => {
  mockResponses();
  renderPage();
  await screen.findAllByLabelText(new RegExp('Milklab Milk 1L best before', 'i'));

  hoverChip('Milklab Milk 1L');
  await waitFor(() => {
    expect(screen.getByText(/8 units on the dated lot/)).toBeInTheDocument();
  });
  // The tooltip shows the human-formatted date ("Sep 9, 2026" style).
  expect(screen.getByText(/best before [A-Z][a-z]{2} \d{1,2}, \d{4}/)).toBeInTheDocument();
  expect(screen.getByText(/FEFO consumes this lot first/)).toBeInTheDocument();
});

test('Best-before filter narrows rows (expired / dated / undated)', async() => {
  mockResponses();
  renderPage();
  await screen.findAllByLabelText(new RegExp('Milklab Milk 1L best before', 'i'));

  const selects = screen.getAllByRole('combobox');
  const bestBefore = selects.find((el) => el.closest('.MuiFormControl-root')?.textContent.includes('Best before'));

  // "Expired only" → Milklab stays (nearest lot already past), others drop.
  fireEvent.mouseDown(bestBefore);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('Expired only'));
  await waitFor(() => expect(screen.queryByText('Torani Vanilla Syrup')).not.toBeInTheDocument());
  expect(screen.getByText('Milklab Milk 1L')).toBeInTheDocument();
  expect(screen.queryByText('Beryls Compound')).not.toBeInTheDocument();

  // "No date recorded" → only the undated row remains. (Scoped to the table:
  // the Expiring-soon card keeps its own chips regardless of the filter.)
  fireEvent.mouseDown(bestBefore);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('No date recorded'));
  await waitFor(() => expect(screen.getByText('Beryls Compound')).toBeInTheDocument());
  const table = document.querySelector('table');
  expect(within(table).queryByLabelText(/best before/i)).not.toBeInTheDocument();
});

test('search + expiry filter compose (AND)', async() => {
  mockResponses();
  renderPage();
  await screen.findAllByLabelText(new RegExp('Milklab Milk 1L best before', 'i'));

  const selects = screen.getAllByRole('combobox');
  const bestBefore = selects.find((el) => el.closest('.MuiFormControl-root')?.textContent.includes('Best before'));

  // Dated rows only…
  fireEvent.mouseDown(bestBefore);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('Dated only (any best-before)'));
  await waitFor(() => expect(screen.queryByText('Beryls Compound')).not.toBeInTheDocument());

  // …then a search that matches only one of the two.
  fireEvent.change(screen.getByLabelText(/Search products/i), { target: { value: 'torani' } });
  await waitFor(() => expect(screen.queryByText('Milklab Milk 1L')).not.toBeInTheDocument());
  expect(screen.getByText('Torani Vanilla Syrup')).toBeInTheDocument();
  const tableAfterSearch = document.querySelector('table');
  expect(
    within(tableAfterSearch).getByLabelText(new RegExp('Torani Vanilla Syrup best before', 'i')),
  ).toBeInTheDocument();
});

test('Expiring-within-30-days card aggregates the nearest lots and lists the products', async() => {
  mockResponses();
  renderPage();

  const card = await screen.findByLabelText('Expiring within 30 days summary');

  // Two products qualify (product 1 expired 7d ago, product 2 18d out);
  // 8 + 6 = 14 units sit on their dated lots.
  expect(within(card).getByText('2')).toBeInTheDocument();
  expect(within(card).getByText(/14 units on dated lots/)).toBeInTheDocument();

  // Chips name each qualifying product with its urgency…
  expect(within(card).getByText('Milklab Milk 1L — expired 7d ago')).toBeInTheDocument();
  expect(within(card).getByText('Torani Vanilla Syrup — 18d left')).toBeInTheDocument();

  // …and the undated product never appears.
  expect(within(card).queryByText(/Beryls Compound/)).not.toBeInTheDocument();
});

test('Expiring-within-30-days card shows the empty state when nothing is dated', async() => {
  apiGet.mockImplementation((url) => {
    if (url.startsWith('/api/inventory')) return Promise.resolve(inventory);
    if (url.startsWith('/api/stock-lots')) return Promise.resolve([]); // no dated lots at all
    return Promise.resolve([]);
  });
  renderPage();

  const card = await screen.findByLabelText('Expiring within 30 days summary');
  await waitFor(() => expect(within(card).getByText('0')).toBeInTheDocument());
  expect(
    within(card).getByText(/Nothing dated expires in the next 30 days/),
  ).toBeInTheDocument();
});
