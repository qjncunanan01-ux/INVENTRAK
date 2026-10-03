// The cost work queue: coverage, filters, sorting, inline editing, and the
// margin panel.
//
// These are locked down because the feature's whole failure mode was silence.
// The bulk sheet could WRITE costs but nothing could say how many were left or
// what they were worth, so the admin could not tell a finished catalog from a
// three-row one. The sort opinion in particular is a deliberate deviation from
// literal behaviour and would otherwise look like a bug to the next reader.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProductsPage from './ProductsPage';
import * as api from '../api';

vi.mock('../api', async() => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPut: vi.fn(),
    apiDelete: vi.fn(),
    bulkUpdateCosts: vi.fn(),
  };
});

// 4 products chosen so every bucket is represented and every figure the panel
// prints can be checked by hand:
//   Almond Roca  P1000 / P250  =  75% margin  rich
//   Blueberry    P500  / —      uncosted
//   Caramel      P400  / P300  =  25% margin  healthy, but under the 30% target
//   Vanilla      P200  / P260  = -30% margin  loss-maker
// Coverage 3/4 = 75%. Blended (1600-810)/1600 = 49%.
const catalog = [
  { id: 1, name: 'Almond Roca', category: 'Syrups', price: 1000, cost: 250 },
  { id: 2, name: 'Blueberry', category: 'Syrups', price: 500, cost: null },
  { id: 3, name: 'Caramel', category: 'Sauces', price: 400, cost: 300 },
  { id: 4, name: 'Vanilla', category: 'Sauces', price: 200, cost: 260 },
];

function mockApi() {
  api.apiGet.mockImplementation((path) => {
    if (path === '/api/products') return Promise.resolve(catalog);
    if (path === '/api/products/costs') {
      return Promise.resolve(catalog.map(p => ({ id: p.id, sku: `PRD-00000${p.id}`, name: p.name, price: p.price, cost: p.cost })));
    }
    if (path === '/api/meta') return Promise.resolve({ ok: true, costing: { target_margin_percent: 30 } });
    if (String(path).startsWith('/api/audit-trail')) return Promise.resolve({ data: [] });
    return Promise.resolve({});
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductsPage onLogout={() => {}} />
    </MemoryRouter>,
  );
}

// Scoped to the products table: the page now carries three tables, so an
// unscoped row query picks up the margin panel's rows too. The aria-labels
// exist for screen readers; the tests get the same benefit.
const productsTable = () => screen.getByRole('table', { name: 'Active products' });

const rowNames = () =>
  within(productsTable()).getAllByRole('row').slice(1)
    .map(r => within(r).getAllByRole('cell')[1]?.textContent || '')
    .filter(Boolean);

const sortHeader = (label) => within(productsTable()).getByText(label);

describe('cost coverage work queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
    api.bulkUpdateCosts.mockResolvedValue({ ok: true, total: 1, updated: 1, cleared: 0, skipped: [] });
  });

  it('states how much of the catalog is costed, not just the row count', async() => {
    renderPage();
    // Before this existed the only feedback after a bulk apply was "Total 204".
    await waitFor(() => expect(screen.getByText(/3 of 4 costed \(75%\)/)).toBeTruthy());
    expect(screen.getByText(/1 still to cost/)).toBeTruthy();
  });

  it('says so plainly when the catalog is fully costed', async() => {
    api.apiGet.mockImplementation((path) => {
      if (path === '/api/products') return Promise.resolve(catalog.map(p => ({ ...p, cost: p.cost ?? 100 })));
      if (path === '/api/products/costs') return Promise.resolve(catalog.map(p => ({ ...p, cost: p.cost ?? 100 })));
      if (path === '/api/meta') return Promise.resolve({ costing: { target_margin_percent: 30 } });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/fully costed/)).toBeTruthy());
  });

  it('filters the table down to the uncosted backlog', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 of 4 costed/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Not costed \(1\)/));
    await waitFor(() => {
      expect(rowNames()).toEqual(['Blueberry']);
    });
  });

  it('filters to products priced below their cost', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 of 4 costed/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Cost ≥ price \(1\)/));
    await waitFor(() => expect(rowNames()).toEqual(['Vanilla']));
  });

  it('copies the uncosted names for pasting into the cost sheet', async() => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 of 4 costed/)).toBeTruthy());
    fireEvent.click(screen.getByText('Copy uncosted names'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Blueberry'));
  });

  it('sinks uncosted products to the bottom in BOTH sort directions', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 of 4 costed/)).toBeTruthy());
    // A literal "sort by margin ascending" would float every unknown to the
    // top, which is technically correct and useless — the unknowns are exactly
    // what the sort is being used to find.
    fireEvent.click(sortHeader('Margin'));
    await waitFor(() => expect(rowNames().pop()).toBe('Blueberry'));
    fireEvent.click(sortHeader('Margin'));
    await waitFor(() => expect(rowNames().pop()).toBe('Blueberry'));
  });
});

describe('inline cost editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
    api.bulkUpdateCosts.mockResolvedValue({ ok: true, total: 1, updated: 1, cleared: 0, skipped: [] });
  });

  it('edits the cost where it is shown, without touching the rest of the product', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText('P250')).toBeTruthy());
    fireEvent.click(screen.getByText('P250'));
    const box = await screen.findByLabelText('Cost of goods for Almond Roca');
    fireEvent.change(box, { target: { value: '300' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    // Scoped by id and to the cost column ONLY. The product PUT full-replaces
    // every column, so using it here would wipe the cost whenever a field was
    // missed — the failure already fixed once in the edit form.
    await waitFor(() => expect(api.bulkUpdateCosts).toHaveBeenCalledWith({ costs: [{ id: 1, cost: 300 }] }));
    expect(api.apiPut).not.toHaveBeenCalled();
  });

  it('treats an emptied cell as an explicit clear, not a no-op', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText('P250')).toBeTruthy());
    fireEvent.click(screen.getByText('P250'));
    const box = await screen.findByLabelText('Cost of goods for Almond Roca');
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(api.bulkUpdateCosts).toHaveBeenCalledWith({ costs: [{ id: 1, cost: null }] }));
  });

  it('cannot be given a negative cost through the field at all', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText('P250')).toBeTruthy());
    fireEvent.click(screen.getByText('P250'));
    const box = await screen.findByLabelText('Cost of goods for Almond Roca');
    // The field sanitizes to digits and one decimal point, so the minus sign is
    // swallowed as it is typed. A negative cost cannot be expressed here, which
    // is why the server-side guard in parseCostEntry is defence in depth rather
    // than the primary defence.
    fireEvent.change(box, { target: { value: '-5' } });
    expect(box.value).toBe('5');
    expect(api.bulkUpdateCosts).not.toHaveBeenCalled();
  });
});

describe('margin overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('blends by value, not by averaging percentages', async() => {
    renderPage();
    // Value-weighted: (1600 - 810) / 1600 = 49%. Averaging the three
    // percentages instead would give (75 + 25 - 30) / 3 = 23%, which lets a
    // ₱200 jar count as much as a ₱1,000 bottle.
    await waitFor(() => expect(screen.getByText('49%')).toBeTruthy());
  });

  it('grades against the target the server reports, not a hardcoded 30', async() => {
    api.apiGet.mockImplementation((path) => {
      if (path === '/api/products') return Promise.resolve(catalog);
      if (path === '/api/products/costs') return Promise.resolve(catalog);
      if (path === '/api/meta') return Promise.resolve({ costing: { target_margin_percent: 45 } });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/below it/)).toBeTruthy());
    expect(screen.getByText('45%')).toBeTruthy();
  });

  it('suggests a price for products under target and names the loss-makers', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Priced below the 30% target/)).toBeTruthy());
    // Worst margin first: Vanilla at -30% (260 / 0.7 = 371.43), then Caramel
    // at 25% (300 / 0.7 = 428.57).
    const rows = within(screen.getByRole('table', { name: 'Products priced below the target margin' }))
      .getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('P371');
    expect(rows.some(r => r.textContent.includes('P429'))).toBe(true);
    expect(screen.getAllByText('Vanilla').length).toBeGreaterThan(0);
  });

  it('reports the blended margin as unknown when nothing is costed', async() => {
    api.apiGet.mockImplementation((path) => {
      if (path === '/api/products') return Promise.resolve(catalog.map(p => ({ ...p, cost: null })));
      if (path === '/api/products/costs') return Promise.resolve(catalog.map(p => ({ ...p, cost: null })));
      if (path === '/api/meta') return Promise.resolve({ costing: { target_margin_percent: 30 } });
      return Promise.resolve({ data: [] });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('BLENDED MARGIN')).toBeTruthy());
    // Not "0%" — an uncosted catalog has no margin, it has no data.
    expect(screen.queryByText('Priced below the 30% target')).toBeNull();
  });
});

describe('bulk cost sheet preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('shows the before/after for every row, which the CLI always did and the browser did not', async() => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/3 of 4 costed/)).toBeTruthy());
    const sheet = screen.getAllByRole('textbox').find(el => (el.placeholder || '').includes('Almond Roca,380'));
    fireEvent.change(sheet, { target: { value: 'Almond Roca,400\nBlueberry,-' } });
    fireEvent.click(screen.getAllByText('Parse preview')[1]);
    await waitFor(() => expect(screen.getByText(/What this will change/)).toBeTruthy());
    expect(screen.getByText(/Almond Roca: P250 → P400/)).toBeTruthy();
    expect(screen.getByText(/Blueberry: not costed → not costed/)).toBeTruthy();
  });
});