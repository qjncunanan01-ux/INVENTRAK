import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import BackupPage from './BackupPage';
import { createAppTheme } from '../../theme';
import { apiGet, apiPost, getMeta } from '../../api';

// This page is the only place an operator can SEE whether the system is keeping
// a copy of the database anywhere other than the container it runs in — and the
// only place they can put one back without a file. So these tests lock the three
// things that would make it silently useless:
//
//   - the schedule's REAL state is on screen (off is stated as off, with what
//     would turn it on), because "backups are configured" is not "backups run"
//   - the snapshots the server took are listed, and one from another driver is
//     refused up front rather than failing on the confirm button
//   - restoring a stored snapshot still takes two deliberate steps: pick it,
//     read what it replaces, confirm. A named id is not consent.
vi.mock('../../api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getMeta: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const listing = (over = {}) => ({
  ok: true,
  error: null,
  scheduler: {
    enabled: true,
    derived: true,
    url: 'https://demo.supabase.co/rest/v1',
    table: 'backup_snapshots',
    keep: 7,
    interval_minutes: 60,
    max_bytes: 4194304,
    last_pushed_at: '2026-10-16T12:00:00.000Z',
    last_pushed_ago_minutes: 15,
    last_error: null,
    pushed: 3,
  },
  // What the server derives from the store it just listed: the newest snapshot,
  // its age, and whether that age is a problem. The page does no arithmetic of
  // its own, so this is the only thing that decides the headline.
  last_backup: {
    configured: true,
    table: 'backup_snapshots',
    interval_minutes: 60,
    stale_after_minutes: 120,
    last_backup_at: '2026-10-16T12:00:00.000Z',
    age_minutes: 15,
    stale: false,
    snapshot_id: 2,
    driver: 'sqlite',
    rows: 612,
    bytes: 204800,
    this_process_last_pushed_at: '2026-10-16T12:00:00.000Z',
    last_attempt_error: null,
    last_attempt_error_at: null,
    reason: null,
  },
  snapshots: [
    { id: 2, created_at: '2026-10-16T12:00:00.000Z', driver: 'sqlite', bytes: 204800, tables: 20, rows: 612 },
    { id: 1, created_at: '2026-10-16T11:00:00.000Z', driver: 'json', bytes: 102400, tables: 6, rows: 206 },
  ],
  ...over,
});

function renderPage() {
  getMeta.mockResolvedValue({ driver: 'sqlite', version: '0.1.0' });
  return render(
    <ThemeProvider theme={createAppTheme()}>
      <MemoryRouter>
        <BackupPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test('the page states that something is being kept outside the container, and how often', async () => {
  apiGet.mockResolvedValue(listing());
  renderPage();
  expect(await screen.findByText('scheduled: on')).toBeTruthy();
  expect(screen.getByText('every 60 min')).toBeTruthy();
  expect(screen.getByText('keeps 7')).toBeTruthy();
  expect(screen.getByText('table: backup_snapshots')).toBeTruthy();
  expect(screen.getByText('last push 15 min ago')).toBeTruthy();
});

test('the last successful backup and its age are the first thing on the card', async () => {
  apiGet.mockResolvedValue(listing());
  renderPage();
  // The headline answers "when was the last backup?" — from the store's newest
  // snapshot, which is also the one a restore would start from.
  expect(await screen.findByText('last backup: fresh')).toBeTruthy();
  expect(
    screen.getByText(/Last successful backup .* · 15 min ago/),
  ).toBeTruthy();
  // ...and "how strict is that?" is stated rather than left to intuition.
  expect(screen.getByText(/Counts as stale after 2 h/)).toBeTruthy();
  expect(screen.getByText(/612 row\(s\), 200 KB/)).toBeTruthy();
});

test('a snapshot that has aged past the threshold is called out as stale', async () => {
  apiGet.mockResolvedValue(listing({
    last_backup: {
      ...listing().last_backup,
      last_backup_at: '2026-10-16T07:00:00.000Z',
      age_minutes: 315,
      stale: true,
    },
  }));
  renderPage();
  expect(await screen.findByText('last backup: stale')).toBeTruthy();
  expect(screen.getByText(/Last successful backup .* · 5 h ago/)).toBeTruthy();
});

test('a store with the timer switched off says the timer is off, not "every 0 min"', async () => {
  apiGet.mockResolvedValue(listing({
    scheduler: { ...listing().scheduler, interval_minutes: 0 },
    last_backup: { ...listing().last_backup, interval_minutes: 0 },
  }));
  renderPage();
  // A configured store with BACKUP_INTERVAL_MINUTES=0: nothing is scheduled,
  // and the page must not claim a cadence it does not have.
  expect(await screen.findByText('scheduled: off')).toBeTruthy();
  expect(screen.getByText('timer: off')).toBeTruthy();
  expect(screen.getByText(/hourly default is the yardstick/)).toBeTruthy();
  // ...and the manual button still works, because that is what it is for.
  expect(screen.getByRole('button', { name: /back up now/i }).disabled).toBe(false);
});

test('a store holding nothing is reported as nothing, not as "fine"', async () => {
  apiGet.mockResolvedValue(listing({
    snapshots: [],
    last_backup: {
      ...listing().last_backup,
      last_backup_at: null,
      age_minutes: null,
      stale: true,
      snapshot_id: null,
      rows: null,
      bytes: null,
      reason: 'no snapshot has been pushed to the durable store yet',
    },
  }));
  renderPage();
  expect(await screen.findByText('last backup: stale')).toBeTruthy();
  expect(screen.getByText('No snapshot has been pushed yet.')).toBeTruthy();
  expect(screen.getByText(/no snapshot has been pushed to the durable store yet/i)).toBeTruthy();
});

test('with no durable store the verdict is unknown, and the page says why', async () => {
  apiGet.mockResolvedValue(listing({
    ok: false,
    error: 'no durable store is configured',
    scheduler: { ...listing().scheduler, enabled: false, url: null, last_pushed_at: null },
    snapshots: [],
    last_backup: {
      ...listing().last_backup,
      configured: false,
      stale: null,
      stale_after_minutes: null,
      last_backup_at: null,
      age_minutes: null,
      reason: 'no durable store is configured',
    },
  }));
  renderPage();
  expect(await screen.findByText('last backup: unknown')).toBeTruthy();
  expect(screen.getByText(/No durable store configured/)).toBeTruthy();
});

test('a schedule that is off says so, names the env vars, and cannot be pressed', async () => {
  apiGet.mockResolvedValue(listing({
    ok: false,
    error: 'no durable store is configured',
    scheduler: { ...listing().scheduler, enabled: false, url: null, last_pushed_at: null },
    snapshots: [],
  }));
  renderPage();
  expect(await screen.findByText('scheduled: off')).toBeTruthy();
  expect(screen.getByText(/SUPABASE_URL/)).toBeTruthy();
  expect(screen.getByText(/BACKUP_REMOTE_URL/)).toBeTruthy();
  expect(screen.getByText(/Once a durable store is configured/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /back up now/i }).disabled).toBe(true);
});

test('the snapshots the server took are listed, and a foreign-driver one cannot be restored here', async () => {
  apiGet.mockResolvedValue(listing());
  renderPage();
  // The sqlite snapshot matches this server (getMeta says sqlite); the json one
  // does not, and must be refused before the confirm button, not after.
  await screen.findByText('sqlite driver · 612 row(s) · 200 KB');
  expect(screen.getByText(/json driver · 206 row\(s\) · 100 KB/)).toBeTruthy();
  expect(screen.getByText(/taken from another driver/)).toBeTruthy();

  const buttons = screen.getAllByRole('button', { name: /restore this/i });
  expect(buttons[0].disabled).toBe(false);
  expect(buttons[1].disabled).toBe(true);
});

test('restoring a stored snapshot takes two steps and names what it replaces', async () => {
  apiGet.mockResolvedValue(listing());
  apiPost.mockResolvedValue({ message: 'Restored 20 table(s), 612 row(s) from the snapshot' });
  renderPage();

  await screen.findByText('sqlite driver · 612 row(s) · 200 KB');
  const [storedRestore] = screen.getAllByRole('button', { name: /restore this/i });
  fireEvent.click(storedRestore);
  // Nothing is written until the dialog is confirmed.
  expect(apiPost).not.toHaveBeenCalled();
  // Asserted on the dialog's text rather than one node: the sentence is built
  // from several interpolated values, so it is not a single text node.
  const dialog = await screen.findByRole('dialog');
  const said = dialog.textContent.replace(/\s+/g, ' ');
  expect(said).toMatch(/replaces every row in every table/i);
  expect(said).toMatch(/612 row\(s\) across 20 table\(s\)/);
  expect(said).toMatch(/taken from the sqlite driver/i);

  fireEvent.click(screen.getByRole('button', { name: /replaces all data/i }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  expect(apiPost).toHaveBeenCalledWith('/api/admin/restore', { confirm: true, snapshot_id: 2 });
});

test('cancelling the confirmation restores nothing', async () => {
  apiGet.mockResolvedValue(listing());
  renderPage();
  await screen.findByText('sqlite driver · 612 row(s) · 200 KB');
  const [storedRestore] = screen.getAllByRole('button', { name: /restore this/i });
  fireEvent.click(storedRestore);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(apiPost).not.toHaveBeenCalled();
});

test('Back up now stores one immediately and re-reads what the store holds', async () => {
  apiGet.mockResolvedValue(listing());
  apiPost.mockResolvedValue({ ok: true, message: 'Snapshot stored (204800 bytes, 612 rows)' });
  renderPage();

  fireEvent.click(await screen.findByRole('button', { name: /back up now/i }));
  await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/admin/backup', {}));
  expect(await screen.findByText(/Snapshot stored/)).toBeTruthy();
  // The list is reloaded, so the new snapshot appears without a page refresh.
  await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(1));
});

test('a durable store that cannot be read is reported, not hidden behind an empty list', async () => {
  apiGet.mockResolvedValue(listing({
    ok: false,
    error: 'cannot reach the durable store at https://demo.supabase.co',
    snapshots: [],
    last_backup: {
      ...listing().last_backup,
      last_backup_at: null,
      age_minutes: null,
      stale: null,
      reason: 'cannot reach the durable store at https://demo.supabase.co',
    },
  }));
  renderPage();
  expect(await screen.findByText(/could not be read/)).toBeTruthy();
  expect(screen.getAllByText(/cannot reach the durable store/).length).toBeGreaterThan(0);
});

test('a failed push is surfaced with its reason AND leaves the last good backup standing', async () => {
  apiGet.mockResolvedValue(listing({
    scheduler: { ...listing().scheduler, last_error: 'durable store refused the POST (HTTP 404)' },
    last_backup: {
      ...listing().last_backup,
      last_attempt_error: 'durable store refused the POST (HTTP 404)',
      last_attempt_error_at: '2026-10-16T12:10:00.000Z',
    },
  }));
  renderPage();
  expect(await screen.findByText(/last backup attempt failed/i)).toBeTruthy();
  expect(screen.getByText(/HTTP 404/)).toBeTruthy();
  // The distinction that matters on the day: a failing store does not mean
  // there is nothing to restore.
  expect(screen.getByText(/still what a restore would use/i)).toBeTruthy();
  expect(screen.getByText('last backup: fresh')).toBeTruthy();
});
