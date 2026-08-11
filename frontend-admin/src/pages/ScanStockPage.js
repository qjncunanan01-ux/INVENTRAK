import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
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
import { useCallback, useEffect, useRef, useState } from 'react';
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

// In-app live camera preview (getUserMedia). The native file-input capture
// intent shows a black screen on several phones, so this gives the admin a
// real on-page preview: start the rear camera, aim, tap Capture, and the
// frame is drawn to a canvas and scanned — no native camera UI involved.
// Falls back gracefully: if the browser blocks the stream (permission denied,
// insecure context, no camera), the error is surfaced and the file-based
// "Take photo / Upload image" buttons remain the fallback.
function LiveCamera({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [err, setErr] = useState('');

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Start the stream once on mount; always release it on unmount/close so
  // the camera light goes off and other apps can use the camera.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 } },
          audio: false,
        });
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        if (alive) {
          setErr(
            e && e.name === 'NotAllowedError'
              ? 'Camera permission was denied. Allow camera access in your browser, or use "Take photo" / "Upload image" instead.'
              : 'Could not start the camera here. Use "Take photo" / "Upload image" instead.'
          );
        }
      }
    })();
    return () => {
      alive = false;
      stop();
    };
  }, [stop]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setErr('Camera is not ready yet — wait a moment and tap Capture again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    stop();
    onCapture(b64);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Box
        sx={{
          position: 'relative',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: '#000',
          width: '100%',
          maxWidth: 480,
          aspectRatio: '4/3',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Box>
      {err ? <Alert severity="warning" sx={{ mt: 1.5 }}>{err}</Alert> : null}
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button variant="contained" onClick={capture} sx={{ backgroundColor: colors.brandPrimary }}>
          Capture & Scan
        </Button>
        <Button variant="outlined" onClick={() => { stop(); onClose(); }}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
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
  const [liveCam, setLiveCam] = useState(false);

  // Shared result handling: show the match card when there are matches, and
  // a clear "no product detected" message when the label read text but nothing
  // in it names a SYLVER catalog product (foreign/unknown labels must not
  // silently return nothing).
  const applyResult = (res) => {
    const body = res && res.data && typeof res.data === 'object' ? res.data : res;
    const matches = body && Array.isArray(body.matches) ? body.matches : [];
    setResult(body);
    if (matches.length === 0) {
      const recognized = body && body.text && body.text.trim();
      setError(
        recognized
          ? 'No SYLVER product detected — this label doesn\u2019t match anything in the catalog. Only products in the SYLVER supply catalog can be scanned.'
          : 'No text recognized. Try a clearer, well-lit photo of the label.'
      );
    }
  };

  const runBase64 = async (image) => {
    setBusy(true);
    setError('');
    setResult(null);
    setFileName('live capture');
    try {
      const processed = await preprocessForOcr(image);
      const res = await ocrStockCheck({ image: processed });
      applyResult(res);
    } catch (err) {
      const detail =
        (err && err.body && (err.body.details || []).join(' · ')) ||
        err.message ||
        'Scan failed. Check that the backend OCR engine is running and try again.';
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

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
      // Send the original file name: catalog-image uploads (e.g. the SYLVER
      // product photos) resolve to the exact product by name on the server,
      // no OCR needed — those ~300px thumbnails contain no readable text.
      const res = await ocrStockCheck({ image, filename: file.name });
      applyResult(res);
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
                startIcon={<VideocamOutlined />}
                onClick={() => { setError(''); setLiveCam(true); }}
                disabled={busy}
                sx={{ backgroundColor: colors.brandPrimary }}
              >
                {busy ? 'Scanning…' : 'Live camera'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<CameraAltOutlined />}
                onClick={() => cameraRef.current && cameraRef.current.click()}
                disabled={busy}
              >
                Take photo
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
        {liveCam && (
          <LiveCamera
            onCapture={(b64) => {
              setLiveCam(false);
              runBase64(b64);
            }}
            onClose={() => setLiveCam(false)}
          />
        )}
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
