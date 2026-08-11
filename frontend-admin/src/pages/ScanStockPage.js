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

// Load an image element with an onload/onerror fallback (img.decode() is
// unavailable on some older mobile browsers) and a safety timeout so a
// slow/huge photo can never hang the scanner.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('Image decode timed out')), 15000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('Could not decode image')); };
    img.src = src;
  });
}

// Browser-side image preprocessing before OCR upload — the server's Tesseract
// reads flat, high-contrast text far better than raw camera shots:
//   1. normalize the long edge to ~1600px (upscale small labels, downscale
//      huge phone photos so upload stays fast),
//   2. grayscale + min/max contrast stretch (kills glare/color noise),
//   3. re-encode as JPEG.
// Pure browser canvas — no dependencies. On any decode failure the original
// image is returned unchanged so a scan is never blocked by this step.
async function preprocessForOcr(b64, mimeType = 'image/jpeg') {
  const LONG_EDGE = 1600;
  const MAX_UPSCALE = 4;
  try {
    const safeMime = mimeType && /^image\//.test(mimeType) ? mimeType : 'image/jpeg';
    const img = await loadImage(`data:${safeMime};base64,${b64}`);
    const scale = Math.min(MAX_UPSCALE, LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const px = imageData.data;
    // Grayscale + find min/max luminance for the contrast stretch.
    let min = 255;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = max - min || 1;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = ((px[i] - min) / range) * 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  } catch {
    return b64;
  }
}

export default function ScanStockPage({ onLogout }) {
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
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
      const rawImage = await fileToBase64(file);
      // Preprocess (grayscale/contrast/normalize) so real camera captures read
      // reliably — the engine is much better on flat, high-contrast text.
      // Pass the real MIME type: PNG uploads decode correctly (and re-encode
      // to JPEG here anyway), JPEG/HEIC photos from the camera work too.
      const image = await preprocessForOcr(rawImage, file.type);
      // The generated client returns the parsed JSON body directly — no
      // `.data` wrapper. But the mobile api.js wraps responses as { data },
      // so tolerate both shapes to be safe.
      const res = await ocrStockCheck({ image });
      setResult(res && res.data && typeof res.data === 'object' ? res.data : res);
    } catch (err) {
      // Surface the backend's own message when it has one (e.g. "OCR engine
      // unavailable") so a failed scan says WHY instead of a generic error.
      const detail =
        (err && err.body && (err.body.details || []).join(' · ')) ||
        err.message ||
        'Scan failed. Check that the backend OCR engine is running and try again.';
      setError(detail);
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
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                startIcon={<CameraAltOutlined />}
                onClick={() => cameraRef.current && cameraRef.current.click()}
                disabled={busy}
                sx={{ backgroundColor: colors.brandPrimary }}
              >
                {busy ? 'Scanning…' : 'Take photo'}
              </Button>
              <Button
                variant="outlined"
                onClick={() => fileRef.current && fileRef.current.click()}
                disabled={busy}
              >
                Upload image
              </Button>
            </Box>
          ) : (
            <Button variant="outlined" startIcon={<ReplayOutlined />} onClick={reset}>
              Scan another
            </Button>
          )}
        </Box>
        {/* Camera capture: its own input so "Take photo" opens the rear
            camera on phones. Browsers that ignore `capture` (some desktop
            Chrome/Safari) fall back to a file picker — still works. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={pick}
        />
        {/* Upload: plain image picker (no capture attribute) — gallery/desktop. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
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
