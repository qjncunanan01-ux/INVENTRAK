import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Snackbar,
  Typography,
} from '@mui/material';
import { apiGet, apiPost, getMeta } from '../../api';
import { colors } from '../../theme';
import usePageTitle from '../../hooks/usePageTitle';
import AdminLayout from '../layout/AdminLayout';

// DATABASE BACKUP AND RECOVERY.
//
// Why this page is not a form: a restore REPLACES every row in every table. It
// is the most destructive action the console offers, so it is deliberately
// two-step — pick a snapshot, read what it actually contains, then confirm. The
// server refuses an unconfirmed restore for the same reason (its `confirm: true`
// flag is what this page's second button sends), so a stray POST cannot do it
// either.
//
// Two ways to recover, and the difference is the whole point:
//
//   1. A SNAPSHOT FILE, which requires an admin who remembered to download one.
//      Kept for the offline/air-gapped case: a file is the only copy that
//      survives the API itself being gone.
//   2. THE DURABLE STORE, where the server pushes a snapshot on a timer
//      (BACKUP_INTERVAL_MINUTES; see backend/src/governance/backup-remote.js).
//      This is the path that works on the day nobody remembered, because it
//      depends on a schedule instead of on a person.
//
// The page states which of the two is actually live, because "backups are
// configured" and "backups happen" are different claims and only one of them
// can be checked here.

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Human summary of what a parsed snapshot holds, from its own metadata. Returns
// null when the file is not a usable snapshot at all.
function describe(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) return null;
  const tables = Object.keys(snapshot.tables);
  const rows = tables.reduce((sum, name) => {
    const value = snapshot.tables[name];
    return sum + (Array.isArray(value) ? value.length : 0);
  }, 0);
  return {
    format: snapshot.format || '(none)',
    version: snapshot.version,
    driver: snapshot.driver || '(none)',
    createdAt: snapshot.created_at || '(none)',
    generatedBy: snapshot.generated_by || '(unknown)',
    tables: tables.sort(),
    rowCount: rows,
  };
}

const bytes = (n) => {
  const value = Number(n) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const minutes = (since) => {
  const value = Math.round(Number(since) || 0);
  if (value < 1) return 'just now';
  if (value < 60) return `${value} min ago`;
  if (value < 60 * 24) return `${Math.round(value / 60)} h ago`;
  return `${Math.round(value / (60 * 24))} d ago`;
};

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

// A DURATION rather than a point in time. minutes() answers "when?" and reads
// "2 h ago", which is the wrong shape in "counts as stale after …".
const span = (since) => {
  const value = Math.round(Number(since) || 0);
  if (value < 60) return `${value} min`;
  if (value < 60 * 24) return `${Math.round((value / 60) * 10) / 10} h`;
  return `${Math.round((value / (60 * 24)) * 10) / 10} d`;
};

export default function BackupPage({ onLogout }) {
  usePageTitle('/backup');
  const [server, setServer] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [fileName, setFileName] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'error' });
  const fileInput = useRef(null);

  // The durable store: what the schedule has already put outside this container.
  const [store, setStore] = useState(null);
  const [storeBusy, setStoreBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [target, setTarget] = useState(null);

  // Which driver this server runs — the restore endpoint refuses a snapshot
  // from any other driver, so showing it here turns a confusing 400 into an
  // up-front fact.
  useEffect(() => {
    let live = true;
    getMeta()
      .then((meta) => { if (live) setServer(meta); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Load what the store holds. A failure here is information, not a crash: the
  // server reports "no durable store configured" as a readable reason.
  const loadStore = useCallback(async () => {
    setStoreBusy(true);
    try {
      const listing = await apiGet('/api/admin/backups');
      setStore(listing);
    } catch (err) {
      setStore({ ok: false, error: err.message, snapshots: [], scheduler: null });
    } finally {
      setStoreBusy(false);
    }
  }, []);

  useEffect(() => { loadStore(); }, [loadStore]);

  const summary = useMemo(() => describe(candidate), [candidate]);
  const driverMismatch = Boolean(summary && server?.driver && summary.driver !== server.driver);

  const scheduler = store?.scheduler || null;
  const snapshots = store?.snapshots || [];
  // A store being CONFIGURED is not a timer RUNNING: BACKUP_INTERVAL_MINUTES=0
  // is a deliberate "no schedule", and a card that says "scheduled: on / every 0
  // min" would be telling an operator the opposite of the truth. Manual
  // "Back up now" stays available either way — that is the point of it.
  const scheduled = Boolean(scheduler?.enabled && scheduler?.interval_minutes > 0);
  // The server's verdict on the newest snapshot it can actually see, which is
  // the one a restore would name. Computed server-side (governance/backup-remote
  // .js summarizeLastBackup) so this page and any other client agree on what
  // "stale" means instead of each inventing a threshold.
  const lastBackup = store?.last_backup || null;
  const freshness = !lastBackup || lastBackup.stale === null
    ? { label: 'unknown', color: 'default' }
    : lastBackup.stale
      ? { label: 'stale', color: 'error' }
      : { label: 'fresh', color: 'success' };

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const snapshot = await apiGet('/api/admin/backup');
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventrak-backup-${stamp()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const rows = Object.values(snapshot?.counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
      setSnackbar({
        open: true,
        message: `Snapshot downloaded — ${Object.keys(snapshot?.tables || {}).length} table(s), ${rows} row(s).`,
        severity: 'success',
      });
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setDownloading(false);
    }
  }, []);

  // Take one now — the manual half of the schedule, so a freshly configured
  // deployment can be verified on the spot instead of waiting a full interval.
  const pushNow = useCallback(async () => {
    setPushing(true);
    try {
      const response = await apiPost('/api/admin/backup', {});
      setSnackbar({ open: true, message: response.message || 'Snapshot stored.', severity: 'success' });
      await loadStore();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
      await loadStore();
    } finally {
      setPushing(false);
    }
  }, [loadStore]);

  const pickFile = useCallback(async (event) => {
    const file = event.target.files && event.target.files[0];
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setCandidate(JSON.parse(text));
    } catch {
      setCandidate({ unusable: 'not JSON' });
      setSnackbar({ open: true, message: 'That file is not valid JSON.', severity: 'error' });
    }
  }, []);

  const restore = useCallback(async () => {
    setRestoring(true);
    try {
      const response = await apiPost('/api/admin/restore', { confirm: true, snapshot: candidate });
      setResult(response);
      setSnackbar({ open: true, message: response.message, severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setRestoring(false);
    }
  }, [candidate]);

  // Restore a copy the server took itself. Same destructive action as the file
  // path, so the same second confirmation: naming a snapshot id is not consent.
  const restoreFromStore = useCallback(async () => {
    if (!target) return;
    setRestoring(true);
    try {
      const response = await apiPost('/api/admin/restore', { confirm: true, snapshot_id: target.id });
      setResult(response);
      setSnackbar({ open: true, message: response.message, severity: 'success' });
      setTarget(null);
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setRestoring(false);
    }
  }, [target]);

  return (
    <AdminLayout title="Backup & Restore" onLogout={onLogout}>
      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Database backup and recovery</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          A snapshot contains the entire durable database — every table, including password
          hashes, which is what makes it restorable. Store it somewhere safe and off this server:
          the backend&apos;s container filesystem is wiped on every deploy, so a snapshot kept
          inside it is not a backup.
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Restoring replaces every row in every table. A snapshot can only be restored into a
          server running the same driver it was taken from.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip size="small" label={`This server: ${server?.driver || 'unknown'} driver`} />
          <Chip size="small" label={`API v${server?.version || '—'}`} />
          <Button variant="contained" onClick={download} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download snapshot'}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, backgroundColor: colors.surfaceAlt }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Scheduled snapshots (outside this container)
          </Typography>
          <Button size="small" variant="outlined" onClick={loadStore} disabled={storeBusy}>
            {storeBusy ? 'Checking…' : 'Refresh'}
          </Button>
          <Button
            variant="contained"
            onClick={pushNow}
            disabled={pushing || !scheduler?.enabled}
          >
            {pushing ? 'Storing…' : 'Back up now'}
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" mb={2}>
          The server pushes a snapshot to the durable store on its own, on a timer
          (<code>BACKUP_INTERVAL_MINUTES</code>), keeping the newest{' '}
          {scheduler?.keep ?? 7}. This is the copy that exists on the day nobody remembered to
          download one — the first snapshot arrives one full interval after the server starts, not
          at boot, so a freshly seeded container never becomes the newest recoverable state.
        </Typography>

        {/* The headline. "When was the last backup, and is it getting old?" is
            the question an operator opens this page to answer, and it is
            answered from the durable store rather than from this process's
            memory — a restart is exactly when the memory is empty. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <Chip size="small" color={freshness.color} label={`last backup: ${freshness.label}`} />
          <Typography variant="body1">
            {lastBackup?.last_backup_at
              ? `Last successful backup ${when(lastBackup.last_backup_at)} · ${minutes(lastBackup.age_minutes)}`
              : lastBackup && lastBackup.configured === false
                ? 'No durable store configured — nothing outside this container is being kept.'
                : 'No snapshot has been pushed yet.'}
          </Typography>
        </Box>
        {lastBackup?.last_backup_at ? (
          <Typography variant="body2" color="text.secondary" mb={1}>
            Counts as stale after {span(lastBackup.stale_after_minutes)} (the schedule is{' '}
            {scheduled ? `every ${scheduler.interval_minutes} min` : 'off, so the hourly default is the yardstick'}),
            and this is the snapshot a restore would start from
            {lastBackup.rows != null ? ` (${lastBackup.rows} row(s), ${bytes(lastBackup.bytes)})` : ''}.
          </Typography>
        ) : null}
        {lastBackup?.reason ? (
          <Alert severity={freshness.color === 'error' ? 'warning' : 'info'} sx={{ mb: 1 }}>
            {lastBackup.reason}
          </Alert>
        ) : null}
        {/* A failed attempt is reported HERE, next to the successful one, because
            the two together are the whole story: the store may be refusing
            writes while the snapshot it already holds is still restorable. */}
        {lastBackup?.last_attempt_error ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            The last backup attempt failed: {lastBackup.last_attempt_error}
            {lastBackup.last_backup_at
              ? ' — the last successful backup above is still what a restore would use.'
              : ''}
          </Alert>
        ) : null}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <Chip
            size="small"
            color={scheduled ? 'success' : 'warning'}
            label={scheduled ? 'scheduled: on' : 'scheduled: off'}
          />
          <Chip
            size="small"
            label={scheduled ? `every ${scheduler.interval_minutes} min` : 'timer: off'}
          />
          <Chip size="small" label={`keeps ${scheduler?.keep ?? '—'}`} />
          <Chip size="small" label={`table: ${scheduler?.table || '—'}`} />
          <Chip
            size="small"
            label={
              scheduler?.last_pushed_at
                ? `last push ${minutes(scheduler.last_pushed_ago_minutes)}`
                : 'nothing pushed by this process yet'
            }
          />
        </Box>

        {!scheduler?.enabled ? (
          <Alert severity="info" sx={{ mb: 1 }}>
            No durable store is configured, so nothing is being kept outside this container. Set{' '}
            <code>SUPABASE_URL</code> and <code>SUPABASE_KEY</code> (the same values the driver
            already uses) or <code>BACKUP_REMOTE_URL</code> and <code>BACKUP_REMOTE_KEY</code>, and
            the schedule starts with the next deploy.
          </Alert>
        ) : null}

        {store && store.ok === false && scheduler?.enabled ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            The durable store could not be read: {store.error}
          </Alert>
        ) : null}

        {snapshots.length > 0 ? (
          <>
            <Divider sx={{ mb: 1 }} />
            <List dense>
              {snapshots.map((snap) => {
                const foreign = Boolean(server?.driver && snap.driver && snap.driver !== server.driver);
                return (
                  <ListItem
                    key={String(snap.id)}
                    divider
                    secondaryAction={
                      <Button
                        size="small"
                        color="error"
                        disabled={foreign || restoring}
                        onClick={() => setTarget(snap)}
                      >
                        Restore this
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={when(snap.created_at)}
                      secondary={
                        `${snap.driver || 'unknown'} driver · ${snap.rows} row(s) · ${bytes(snap.bytes)}` +
                        (foreign ? ' · taken from another driver, cannot be restored here' : '')
                      }
                    />
                  </ListItem>
                );
              })}
            </List>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {scheduler?.enabled
              ? 'The store holds no snapshots yet.'
              : 'Once a durable store is configured, the snapshots it holds are listed here.'}
          </Typography>
        )}
      </Paper>

      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
        <Typography variant="h6" mb={1}>Restore from a snapshot</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Choose a snapshot file, check the summary, then confirm. Nothing is written until you
          press Restore.
        </Typography>

        {/* A file input rather than a drag/drop zone: this is a once-in-a-while
            maintenance action, not a workflow, and the native control is
            keyboard accessible for free. */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="outlined" component="label">
            Choose snapshot file
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={pickFile} />
          </Button>
          {fileName ? <Typography variant="body2" color="text.secondary">{fileName}</Typography> : null}
        </Box>

        {fileName && !summary ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            That file is not a Sylver inventory backup — it has no <code>tables</code> object.
          </Alert>
        ) : null}

        {summary ? (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <Chip size="small" label={`format: ${summary.format}`} color={summary.format === 'inventrak-backup' ? 'default' : 'error'} />
              <Chip size="small" label={`version: ${summary.version ?? '—'}`} color={summary.version === 1 ? 'default' : 'error'} />
              <Chip size="small" label={`driver: ${summary.driver}`} color={driverMismatch ? 'error' : 'default'} />
              <Chip size="small" label={`${summary.tables.length} table(s)`} />
              <Chip size="small" label={`${summary.rowCount} row(s)`} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Taken {summary.createdAt} by {summary.generatedBy}.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, wordBreak: 'break-word' }}>
              Tables: {summary.tables.join(', ')}
            </Typography>
            {driverMismatch ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                This snapshot was taken from the <strong>{summary.driver}</strong> driver, but this
                server runs <strong>{server?.driver}</strong>. The row shapes differ between
                drivers, so the server will refuse it — export from this server instead.
              </Alert>
            ) : null}
            <Button
              variant="contained"
              color="error"
              sx={{ mt: 2 }}
              onClick={restore}
              disabled={restoring || driverMismatch || summary.format !== 'inventrak-backup'}
            >
              {restoring ? 'Restoring…' : 'Restore now — replaces all data'}
            </Button>
          </Box>
        ) : null}

        {result ? (
          <Alert severity="success" sx={{ mt: 2 }}>
            {result.message}
          </Alert>
        ) : null}
      </Paper>

      {/* The second step for a stored snapshot: name what is about to be
          replaced and what it will be replaced with, then confirm. */}
      <Dialog open={Boolean(target)} onClose={() => (restoring ? null : setTarget(null))}>
        <DialogTitle>Restore the snapshot from {when(target?.created_at)}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This replaces every row in every table with that snapshot: {target?.rows} row(s) across{' '}
            {target?.tables} table(s), taken from the {target?.driver} driver. Anything written
            since then is lost, and it cannot be undone from this page.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)} disabled={restoring}>Cancel</Button>
          <Button color="error" variant="contained" onClick={restoreFromStore} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore now — replaces all data'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </AdminLayout>
  );
}
