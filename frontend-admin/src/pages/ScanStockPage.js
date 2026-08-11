import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';
import { imageUrl, ocrStockCheck } from '../api';
import { colors } from '../theme';
import AdminLayout from './AdminLayout';

const STATUS_META = {
  ok: { label: 'In stock', color: 'success' },
  low: { label: 'Low stock', color: 'warning' },
  out: { label: 'Out of stock', color: 'error' },
};

// Reads an image file as a base64 data URL (stripping the data:...;base64, prefix).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      resolve(raw.includes(',') ? raw.split(',')[1] : raw);
    };
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

export default function ScanStockPage({ onLogout }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [fileName, setFileName] = useState('');

  const pick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    run(file);
  };

  const run = async (file) => {
    setBusy(true);
    setError('');
    setResult(null);
    setFileName(file.name);
    try {
      const image = await fileToBase64(file);
      const res = await ocrStockCheck({ image });
      setResult(res && res.data ? res.data : res);
    } catch (err) {
      setError(
        err.message || 'Scan failed. Check that the backend OCR engine is running and try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError('');
    setFileName('');
  };

  const top = result && result.matches && result.matches[0];
  const others = result && result.matches ? result.matches.slice(1) : [];
  const locs = top
    ? Object.keys(top.stock?.locations || {})
    : [];

  return (
    <AdminLayout title="Scan & Stock" onLogout={onLogout}>
      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">Scan a product label</Typography>
            <Typography variant="body2" color="text.secondary">
              The daily manual-inventory answer: snap or upload a label, and the OCR engine
              matches it to the catalog with the live stock at every location.
            </Typography>
          </div>
          {!result ? (
            <Button
              variant="contained"
              startIcon={<CameraAltOutlined />}
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={busy}
              sx={{ backgroundColor: colors.brandPrimary }}
            >
              {busy ? 'Scanning…' : fileName ? `Scan ${fileName}` : 'Scan a label'}
            </Button>
          ) : (
            <Button variant="outlined" startIcon={<ReplayOutlined />} onClick={reset}>
              Scan another
            </Button>
          )}
        </Box>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={pick}
        />
        {busy && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, color: 'text.secondary' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Running OCR on the label…</Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Paper>

      {result && top && (
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
          {result.text ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Recognized: {result.text.replace(/\n/g, ' · ').slice(0, 200)}
            </Typography>
          ) : null}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            {top.image ? (
              <Box
                component="img"
                src={imageUrl(top.image)}
                alt={top.name}
                sx={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 2, backgroundColor: colors.surface }}
              />
            ) : (
              <Box sx={{ width: 84, height: 84, borderRadius: 2, backgroundColor: colors.surface }} />
            )}
            <Box>
              <Typography variant="h6">{top.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {top.score >= 0.75 ? `${Math.round(top.score * 100)}% match` : `${Math.round(top.score * 100)}% match`}
                {top.price != null ? ` · P${top.price}` : ''}
              </Typography>
              <Chip
                size="small"
                color={STATUS_META[top.stock?.status]?.color}
                label={`${STATUS_META[top.stock?.status]?.label || 'Unknown'} · ${top.stock?.total ?? 0} total`}
                sx={{ mt: 1 }}
              />
            </Box>
          </Box>

          <Table size="small" sx={{ maxWidth: 480 }}>
            <TableHead>
              <TableRow>
                <TableCell>Location</TableCell>
                <TableCell align="right">Qty</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {locs.length === 0 ? (
                <TableRow><TableCell colSpan={2}>No stock recorded</TableCell></TableRow>
              ) : (
                locs.map((loc) => (
                  <TableRow key={loc}>
                    <TableCell>{loc}</TableCell>
                    <TableCell align="right"><strong>{top.stock.locations[loc] ?? 0}</strong></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {others.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Other possible matches
              </Typography>
              {others.map((m) => (
                <Box key={m.id ?? m.name} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1 }}>
                  <Box
                    component="img"
                    src={imageUrl(m.image)}
                    alt={m.name}
                    sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1, backgroundColor: colors.surface }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>{m.name}</Typography>
                  <Chip
                    size="small"
                    color={STATUS_META[m.stock?.status]?.color}
                    label={`${m.stock?.total ?? 0} · ${STATUS_META[m.stock?.status]?.label || '?'}`}
                  />
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}
    </AdminLayout>
  );
}
