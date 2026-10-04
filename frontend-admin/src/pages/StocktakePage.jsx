import {
  Alert, Box, Button, Chip, LinearProgress, Paper, Table, TableBody,
  TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { apiGet } from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';
import FormulaBanner from '../components/FormulaBanner';

// STOCKTAKE SCHEDULE — which shelves are due to be walked again.
//
// "Shelf vs System" tells a manager what a count FOUND. This page answers the
// question that comes before any count exists: is that count still worth
// anything? A reconciliation anchored on a shelf last walked four months ago is
// not evidence of anything, so the schedule exists to keep the anchor honest.
//
// The rule this screen enforces, stated on the page itself because it is the
// part people argue with:
//
//   A shelf is re-counted only when EVERY line stocked on it is inside the
//   cycle. Counting one bottle out of forty does not re-count the shelf.
//
// The tempting alternative — reset the clock on the newest count — would let
// one quick count mark a whole shelf fresh for a month. That manufactures the
// exact false confidence this feature exists to remove, so coverage is counted
// per LINE and stays below 100% until the shelf is genuinely walked.
//
// Nothing here is scheduled by a timer. The board is computed on read, because
// the free deployment tier sleeps and a timer that never fires is
// indistinguishable from one nobody set. Reading the page also raises and
// resolves the same overdue flags on the Alerts page, so the two can never
// disagree.

export const STATUS_META = {
  overdue: { label: 'Overdue', color: 'error' },
  never_counted: { label: 'Never counted', color: 'warning' },
  ok: { label: 'Up to date', color: 'success' },
  empty: { label: 'No stock', color: 'default' },
};

export function statusMeta(row) {
  return STATUS_META[row?.status] || STATUS_META.empty;
}

// "3 days overdue" / "due in 12 days" / "due today" — the words a shelf-walker
// needs, rather than a bare signed number they have to interpret.
export function dueLabel(row) {
  if (!row || row.status === 'empty') return 'Nothing stocked here';
  if (row.status === 'never_counted') return 'Never counted';
  // `Number(null)` is 0, so an absent due date would fall through to "Due
  // today" — which is a claim this screen cannot support. Check for absent
  // BEFORE coercing, and say nothing rather than something confident.
  if (row.days_until_due === null || row.days_until_due === undefined) return '—';
  const n = Number(row.days_until_due);
  if (!Number.isFinite(n)) return '—';
  if (n < 0) {
    const d = Math.abs(n);
    return `${d} day${d === 1 ? '' : 's'} overdue`;
  }
  if (n === 0) return 'Due today';
  return `Due in ${n} day${n === 1 ? '' : 's'}`;
}

export function headline(summary) {
  if (!summary) return '';
  const { shelves_needing_count: due = 0, locations = 0, lines_stale: lines = 0 } = summary;
  if (due === 0) {
    return `Every shelf is inside its ${summary.cycle_days}-day cycle. Nothing to walk.`;
  }
  // "shelf" has an IRREGULAR plural: appending "es" as you would for a count of
  // anything else prints "2 of 4 shelfes" on the page a manager reads. Caught by
  // StocktakePage.test.jsx asserting the sentence, not just that it rendered.
  return (
    `${due} of ${locations} ${locations === 1 ? 'shelf' : 'shelves'} ` +
    `${due === 1 ? 'needs' : 'need'} walking — ` +
    `${lines} line${lines === 1 ? '' : 's'} past due.`
  );
}

export default function StocktakePage({ onLogout }) {
  usePageTitle('/stocktake');
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await apiGet('/api/stocktake'));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = (board && board.rows) || [];
  const summary = (board && board.summary) || null;

  return (
    <AdminLayout title="Stocktake Schedule" onLogout={onLogout}>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6">Recount schedule</Typography>
          <Button size="small" onClick={load} disabled={loading}>Refresh</Button>
        </Box>

        <Typography variant="body2" color="text.secondary" mb={2}>
          {headline(summary)}
        </Typography>

        <FormulaBanner
          dense
          title="What counts as a re-count"
          items={[
            'a shelf is re-counted when EVERY line stocked on it has a fresh count',
            `fresh              counted within the last ${(summary && summary.cycle_days) || 30} days`,
            'stale              counted, but longer ago than the cycle',
            'never counted      stocked on this shelf, but no count has ever been recorded',
            'coverage           fresh lines / total lines — below 100% until the shelf is fully walked',
          ]}
          note="A partial walk does not reset the shelf: one line counted out of forty still shows as overdue, because the other thirty-nine have not been checked. Only products with stock on the shelf are counted, and an empty shelf is never overdue."
        />
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Shelves</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Shelf</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Coverage</TableCell>
              <TableCell align="right">Lines to walk</TableCell>
              <TableCell>Last count</TableCell>
              <TableCell>Next due</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>No shelves yet. Add a branch location and stock will be scheduled automatically.</TableCell>
              </TableRow>
            ) : rows.map(r => {
              const meta = statusMeta(r);
              const due = Number(r.stale_lines) + Number(r.never_counted_lines);
              const pct = r.coverage === null || r.coverage === undefined ? 0 : Math.round(r.coverage * 100);
              return (
                <TableRow key={r.location_id}>
                  <TableCell>{r.location}</TableCell>
                  <TableCell><Chip size="small" color={meta.color} label={meta.label} /></TableCell>
                  <TableCell sx={{ minWidth: 140 }}>
                    <Tooltip title={`${r.fresh_lines} of ${r.total_lines} lines counted inside the cycle`}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          color={pct === 100 ? 'success' : 'warning'}
                          sx={{ flex: 1, height: 8, borderRadius: 4 }}
                        />
                        <Typography variant="caption" color="text.secondary">{pct}%</Typography>
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">{due}</TableCell>
                  <TableCell>{r.last_count_at ? new Date(r.last_count_at).toLocaleDateString() : '—'}</TableCell>
                  <TableCell>{dueLabel(r)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {rows.length > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Counts are recorded on <RouterLink to="/reconciliation">Shelf vs System</RouterLink>, which
            also shows what the count found.{' '}
            {summary && summary.computed_at && <>Board as of {new Date(summary.computed_at).toLocaleString()}.</>}
          </Typography>
        )}
      </Paper>
    </AdminLayout>
  );
}