import { Box, Button, Chip, Paper, Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

// How often the open page re-checks the server for new staff submissions.
// Mirrors the staff app's Requests screen (15s there, 15s here) so the full
// staff → owner loop plays out live on both ends: a phone submits, this
// queue shows the new "Requested by" row within one tick, and the decision
// lands back on the phone the same way. Only while the tab is visible.
const AUTO_REFRESH_MS = 15000;

export default function ApprovalsPage({ onLogout }) {
  usePageTitle('/approvals');
  const [data, setData] = useState({ adjustments: [], transfers: [] });
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [lastSynced, setLastSynced] = useState(null);
  // Open correction requests, keyed nothing: the admin's view of instructions
  // still outstanding. A correction is created by rejecting with a comment.
  const [corrections, setCorrections] = useState([]);
  // Draft reject comments, per row (`adjustment-12` / `transfer-3`). Kept in a
  // map so typing in one row cannot clear another, and cleared on send so a
  // stale comment is never attached to the next rejection by accident.
  const [comments, setComments] = useState({});
  // Re-entrancy guard: a Render cold start can take 30s+, so timer ticks can
  // overlap an in-flight request. Skip a tick rather than pile up requests.
  const inFlight = useRef(false);

  // `silent` refreshes swap the data in place (no Loading… flicker, no error
  // snackbar spam while the backend briefly hiccups); the first load and
  // explicit reloads keep the original visible-loading behavior.
  const loadData = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await apiGet('/api/approvals');
      setData({ adjustments: res.adjustments || [], transfers: res.transfers || [] });
      setLastSynced(new Date());
    } catch (err) {
      // Silent (timer) polls keep the last good queue on failure; only
      // user-driven loads surface the error.
      if (!silent) setSnackbar({ open: true, message: 'Failed to load approvals: ' + err.message, severity: 'error' });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const loadCorrections = useCallback(async () => {
    try {
      const rows = await apiGet('/api/correction-requests?status=open');
      setCorrections(Array.isArray(rows) ? rows : []);
    } catch {
      // Silent: this panel is context for the queue, not the queue itself, and
      // a failed read must not blank the decisions the page exists for.
      setCorrections([]);
    }
  }, []);

  useEffect(() => { loadData(); loadCorrections(); }, [loadData, loadCorrections]);

  // Live queue: poll while the page is open, skipping ticks while the
  // browser tab is hidden (no wasted requests in a background tab).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadData(true);
      loadCorrections();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData, loadCorrections]);

  // `comment` is the optional correction instruction. Sending it on a reject
  // records a correction request tied to the submission, which the submitter's
  // own Requests screen shows on its next poll — that is the whole feedback
  // loop, and it needs no new endpoint on the staff side.
  const decide = async(kind, id, action, comment) => {
    const key = `${kind}-${id}`;
    try {
      const result = await apiPost(`/api/stock-${kind === 'adjustment' ? 'adjustments' : 'transfers'}/${id}/${action}`, {
        ...(comment && comment.trim() ? { comment } : {}),
      });
      setComments((prev) => ({ ...prev, [key]: '' }));
      setSnackbar({ open: true, message: result.message, severity: 'success' });
      await loadData(true);
      await loadCorrections();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const resolveCorrection = async (id) => {
    try {
      await apiPost(`/api/correction-requests/${id}/resolve`, { status: 'closed' });
      setSnackbar({ open: true, message: 'Correction request closed.', severity: 'success' });
      await loadCorrections();
      await loadData(true);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  const total = adjustments.length + transfers.length;

  return (
    <AdminLayout title="Approvals" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Approval of important transactions</Typography>
        <Typography variant="body2" color="text.secondary">
          {loading ? 'Loading pending requests...' : `${total} pending request${total === 1 ? '' : 's'} awaiting your decision. Approving applies the change to stock; rejecting leaves stock untouched.`}
        </Typography>
        {/* Live queue: new staff submissions appear here on their own — no
            reload needed (mirrors the staff app's live Requests screen). */}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {lastSynced
            ? `Live · updated ${lastSynced.toLocaleTimeString()} · checks every 15s`
            : 'Live · checks every 15s'}
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Pending stock adjustments ({adjustments.length})</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Product</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Current → Corrected</TableCell>
                <TableCell>Best before</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8}>Loading…</TableCell></TableRow>
              ) : adjustments.length === 0 ? (
                <TableRow><TableCell colSpan={8}>No pending adjustments.</TableCell></TableRow>
              ) : adjustments.map(r => (
                <TableRow key={'a' + r.id}>
                  <TableCell>{r.product_name}</TableCell>
                  <TableCell>{r.location_name}</TableCell>
                  <TableCell>{r.current_qty} → <strong>{r.new_qty}</strong></TableCell>
                  <TableCell>
                    {r.expiry_date
                      ? <Chip size="small" color="warning" label={r.expiry_date} />
                      : '—'}
                  </TableCell>
                  <TableCell>{r.reason || '-'}</TableCell>
                  {/* Submitter identity — who physically counted this stock (the
                      staff app stamps it on submit; legacy rows show '—'). */}
                  <TableCell>{r.created_by || '—'}</TableCell>
                  <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <Button size="small" variant="contained" color="success" onClick={() => decide('adjustment', r.id, 'approve')}>
                        {r.expiry_date ? '✓ Approve & stamp expiry' : '✓ Approve'}
                      </Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => decide('adjustment', r.id, 'reject', comments[`adjustment-${r.id}`])}>✕ Reject</Button>
                    </Box>
                    {/* Typing here turns a rejection into a correction request:
                        the submitter's Requests screen shows it on its next
                        poll. Leaving it blank rejects exactly as before. */}
                    <TextField
                      size="small"
                      fullWidth
                      label="Correction note (optional)"
                      placeholder="What should they fix?"
                      value={comments[`adjustment-${r.id}`] || ''}
                      onChange={(e) => setComments((prev) => ({ ...prev, [`adjustment-${r.id}`]: e.target.value }))}
                      sx={{ minWidth: 220 }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={2}>Pending stock transfers ({transfers.length})</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Product</TableCell>
                <TableCell>From → To</TableCell>
                <TableCell>Qty</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
              ) : transfers.length === 0 ? (
                <TableRow><TableCell colSpan={6}>No pending transfers.</TableCell></TableRow>
              ) : transfers.map(r => (
                <TableRow key={'t' + r.id}>
                  <TableCell>{r.product_name}</TableCell>
                  <TableCell>{r.src_location_name} → {r.dst_location_name}</TableCell>
                  <TableCell><strong>{r.qty}</strong></TableCell>
                  <TableCell>{r.reason || '-'}</TableCell>
                  <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <Button size="small" variant="contained" color="success" onClick={() => decide('transfer', r.id, 'approve')}>✓ Approve</Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => decide('transfer', r.id, 'reject', comments[`transfer-${r.id}`])}>✕ Reject</Button>
                    </Box>
                    <TextField
                      size="small"
                      fullWidth
                      label="Correction note (optional)"
                      placeholder="What should they fix?"
                      value={comments[`transfer-${r.id}`] || ''}
                      onChange={(e) => setComments((prev) => ({ ...prev, [`transfer-${r.id}`]: e.target.value }))}
                      sx={{ minWidth: 220 }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      {/* Outstanding correction requests. The loop only closes if someone can
          see what is still unanswered, so the open ones are listed with the
          submission they belong to and a way to close them once addressed. */}
      <Paper sx={{ p: 3, mt: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Open correction requests ({corrections.length})</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Sent to a submitter when a request was rejected with a correction note. They stay open
          until answered — closing one clears the instruction from the submitter&apos;s screen.
        </Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Submission</TableCell>
                <TableCell>Correction</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Sent</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {corrections.length === 0 ? (
                <TableRow><TableCell colSpan={5}>No open correction requests.</TableCell></TableRow>
              ) : corrections.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.submission_type || 'submission'} #{c.submission_id}</TableCell>
                  <TableCell>{c.comment}</TableCell>
                  <TableCell>{c.requested_by || '—'}</TableCell>
                  <TableCell>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => resolveCorrection(c.id)}>
                      Mark addressed
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} message={snackbar.message} />
    </AdminLayout>
  );
}
