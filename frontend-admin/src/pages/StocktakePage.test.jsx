import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import StocktakePage, { dueLabel, headline, statusMeta } from './StocktakePage';
import { createAppTheme } from '../theme';
import { apiGet } from '../api';

// The stocktake board is the screen that makes "every shelf gets re-counted on
// a cycle" DEMONSTRABLE, so these tests lock what a panel would look at:
//
//   - the shelf that must be walked today is at the TOP, not buried
//   - coverage is honest: a partially-walked shelf says so, and does not
//     report 100% just because one line was counted recently
//   - an overdue shelf says how far past due it is, in words
//   - an empty shelf is never nagged about
//
// Regression guard for the mistake this feature is most likely to grow into:
// rendering a partial walk as a complete one. That is invisible to a test that
// only checks "the page renders", and it is the failure that would make the
// whole schedule a lie.

vi.mock('../api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getMeta: vi.fn(() => Promise.reject(new Error('offline'))),
  getCurrentUser: () => ({ role: 'admin' }),
}));

window.matchMedia = window.matchMedia || (() => ({
  matches: false,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));

// Unmount between tests. Without this, every render stays in document.body and
// `screen` happily matches a table from a PREVIOUS test — which would let a
// broken page pass as long as some earlier render happened to contain the text.
afterEach(cleanup);

const iso = (daysAgo) => new Date(Date.UTC(2026, 9, 1) - daysAgo * 86400000).toISOString();

// Showroom: two lines, one counted 40 days ago, one never counted.
// Warehouse: fully counted 5 days ago.
// Cold Room: nothing stocked.
function board() {
  return {
    cycle_days: 30,
    rows: [
      {
        location_id: 1, location: 'Showroom', status: 'overdue',
        total_lines: 2, fresh_lines: 0, stale_lines: 1, never_counted_lines: 1,
        coverage: 0, last_count_at: iso(40), due_at: iso(-10), days_until_due: -10,
        days_since_oldest_fresh: 40, cycle_days: 30,
      },
      {
        location_id: 3, location: 'Cold Room', status: 'never_counted',
        total_lines: 4, fresh_lines: 0, stale_lines: 0, never_counted_lines: 4,
        coverage: 0, last_count_at: null, due_at: null, days_until_due: null,
        days_since_oldest_fresh: null, cycle_days: 30,
      },
      {
        location_id: 2, location: 'Warehouse', status: 'ok',
        total_lines: 6, fresh_lines: 6, stale_lines: 0, never_counted_lines: 0,
        coverage: 1, last_count_at: iso(5), due_at: iso(25), days_until_due: 25,
        days_since_oldest_fresh: 5, cycle_days: 30,
      },
      {
        location_id: 4, location: 'Office Store', status: 'empty',
        total_lines: 0, fresh_lines: 0, stale_lines: 0, never_counted_lines: 0,
        coverage: null, last_count_at: null, due_at: null, days_until_due: null,
        days_since_oldest_fresh: null, cycle_days: 30,
      },
    ],
    summary: {
      cycle_days: 30, locations: 4, shelves_needing_count: 2, shelves_ok: 1, shelves_empty: 1,
      lines_total: 12, lines_stale: 6, computed_at: iso(0),
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={createAppTheme()}>
        <StocktakePage onLogout={() => {}} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('the board says what a shelf-walker needs to know', () => {
  test('the shelf to walk today is at the top of the table', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    await screen.findByText('Showroom');
    const cells = screen.getAllByRole('cell').map(c => c.textContent);
    expect(cells.indexOf('Showroom')).toBeLessThan(cells.indexOf('Warehouse'), 'worst shelf first');
  });

  test('a partially-walked shelf does NOT read as fully counted', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    const row = (await screen.findByText('Showroom')).closest('tr');
    // One of two lines is stale: coverage is 0%, not 100%.
    expect(within(row).getByText('0%')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy(); // lines to walk = stale + never
    expect(within(row).queryByText('100%')).toBeNull();
  });

  test('an overdue shelf says how far past due it is, in words', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    expect(await screen.findByText('10 days overdue')).toBeTruthy();
  });

  test('a shelf inside its cycle says when it is next due', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    expect(await screen.findByText('Due in 25 days')).toBeTruthy();
  });

  test('a fully counted shelf shows 100%', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    const row = (await screen.findByText('Warehouse')).closest('tr');
    expect(within(row).getByText('100%')).toBeTruthy();
    expect(within(row).getByText('0')).toBeTruthy(); // nothing to walk
  });

  test('an empty shelf is listed but never nagged about', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    const row = (await screen.findByText('Office Store')).closest('tr');
    expect(within(row).getByText('No stock')).toBeTruthy();
    expect(within(row).queryByText(/overdue/i)).toBeNull();
  });

  test('the rule that makes a partial walk count as partial is printed on the page', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    // If this text ever disappears, the screen can start lying quietly.
    expect(await screen.findByText(/EVERY line stocked on it/i)).toBeTruthy();
  });

  test('the summary names the shelves and lines at stake', async () => {
    apiGet.mockResolvedValue(board());
    const { container } = renderPage();
    await screen.findByText('Showroom');
    // Asserted against the rendered text rather than one node: the headline is
    // built from several interpolated pieces, so getByText's "smallest element
    // containing the match" rule is the wrong tool for asserting wording.
    expect(container.textContent).toContain('2 of 4 shelves need walking');
    expect(container.textContent).toContain('6 lines past due');
  });

  test('an all-clear board says there is nothing to do', async () => {
    apiGet.mockResolvedValue({
      ...board(),
      rows: board().rows.filter(r => r.status === 'ok'),
      summary: { ...board().summary, shelves_needing_count: 0, lines_stale: 0 },
    });
    renderPage();
    expect(await screen.findByText(/Every shelf is inside its 30-day cycle/)).toBeTruthy();
  });

  test('a server error is surfaced rather than swallowed into an empty table', async () => {
    apiGet.mockRejectedValue(new Error('Stocktake board unavailable'));
    renderPage();
    expect(await screen.findByText('Stocktake board unavailable')).toBeTruthy();
  });

  test('refresh re-reads the board', async () => {
    apiGet.mockResolvedValue(board());
    renderPage();
    await screen.findByText('Showroom');
    const before = apiGet.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('the wording helpers', () => {
  test('dueLabel speaks in whole days and pluralises correctly', () => {
    expect(dueLabel({ status: 'overdue', days_until_due: -1 })).toBe('1 day overdue');
    expect(dueLabel({ status: 'overdue', days_until_due: -10 })).toBe('10 days overdue');
    expect(dueLabel({ status: 'ok', days_until_due: 1 })).toBe('Due in 1 day');
    expect(dueLabel({ status: 'ok', days_until_due: 0 })).toBe('Due today');
    expect(dueLabel({ status: 'empty' })).toBe('Nothing stocked here');
    expect(dueLabel({ status: 'never_counted' })).toBe('Never counted');
    expect(dueLabel({ status: 'ok', days_until_due: null })).toBe('—');
    expect(dueLabel(null)).toBe('Nothing stocked here');
  });

  test('headline never claims a count where there is not one', () => {
    expect(headline({ shelves_needing_count: 1, locations: 1, lines_stale: 1, cycle_days: 30 }))
      .toBe('1 of 1 shelf needs walking — 1 line past due.');
    // "shelf" is irregular: shelves, never "shelfes".
    expect(headline({ shelves_needing_count: 2, locations: 4, lines_stale: 6, cycle_days: 30 }))
      .toBe('2 of 4 shelves need walking — 6 lines past due.');
    expect(headline({ shelves_needing_count: 0, locations: 3, lines_stale: 0, cycle_days: 30 }))
      .toBe('Every shelf is inside its 30-day cycle. Nothing to walk.');
    expect(headline(null)).toBe('');
    expect(headline({})).toBe('Every shelf is inside its undefined-day cycle. Nothing to walk.');
  });

  test('statusMeta has a chip for every status the API can return', () => {
    for (const s of ['ok', 'overdue', 'never_counted', 'empty']) {
      expect(statusMeta({ status: s }).label).toBeTruthy();
    }
    // An unknown status must still render something rather than crash the table.
    expect(statusMeta({ status: 'brand_new' }).label).toBe('No stock');
    expect(statusMeta(undefined).label).toBe('No stock');
  });
});