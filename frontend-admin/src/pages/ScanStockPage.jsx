import QrCode2Outlined from '@mui/icons-material/QrCode2Outlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  apiGet,
  createScanEvent,
  createStockAdjustment,
  createStockTransfer,
  getProductByQr,
  imageUrl,
} from '../api';
import { colors } from '../theme';
import usePageTitle from '../hooks/usePageTitle';
import AdminLayout from './AdminLayout';

// QR INVENTORY SCANNER — QR identifies the product; the inventory staff member
// verifies the physical quantity; the transaction lands in the approval queue.
// (Replaces the OCR label scanner: no text recognition, no fuzzy matching —
// a tag payload resolves to exactly one catalog product.)
//
//   Scan QR → decode identifier → GET /api/products/qr/:code → product
//   → enter counted quantity / transfer → PENDING APPROVAL → owner approves
//
// The QR authorizes nothing: authentication, product status, quantity and the
// approval workflow are all enforced server-side after the scan.

const STATUS_META = {
  ok: { label: 'In stock', color: 'success' },
  low: { label: 'Low stock', color: 'warning' },
  out: { label: 'Out of stock', color: 'error' },
};

const LOC_TAG_RE = /^INVENTRAK:LOC:(\d+):(.+)$/i;
const PROD_TAG_RE = /^INVENTRAK:PROD:(.+)$/i;

// Record the scan in the audit trail (who scanned what, when). Fire-and-forget
// so logging never blocks or fails the workflow.
const logScanEvent = (payload, kind, targetId) => {
  createScanEvent({ payload: String(payload).slice(0, 300), kind, target_id: targetId ?? null }).catch(() => {});
};

// Shared live QR camera surface. Draws video frames onto a canvas and decodes
// with jsQR continuously; the SAME stream renders to <video>. Unmounting it
// releases the camera — the parent unmounts it the moment a code is accepted
// (scan paused while the product transaction is processed, and the same tag
// can never be submitted twice).
function QrScanner({ onDecode }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  // Debounce: onBarcodeScanned-style loops fire on every frame while a code is
  // in view. Same code within one second is ignored; distinct codes always
  // fire so a batch count of several tags feels immediate.
  const lastRef = useRef({ data: '', at: 0 });
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let alive = true;
    let raf = null;
    let stream = null;

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && video.videoWidth && canvas) {
        const w = 480;
        const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        let code = null;
        try {
          code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        } catch {
          code = null; // a bad frame must never kill the loop
        }
        const now = Date.now();
        if (code && code.data) {
          if (!(lastRef.current.data === code.data && now - lastRef.current.at < 1000)) {
            lastRef.current = { data: code.data, at: now };
            onDecodeRef.current(code.data);
          }
        }
      }
      raf = requestAnimationFrame(tick);
      rafRef.current = raf;
    };

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        });
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => {});
        }
        setStarting(false);
        raf = requestAnimationFrame(tick);
        rafRef.current = raf;
      } catch (e) {
        if (alive) {
          setStarting(false);
          setErr(
            e && e.name === 'NotAllowedError'
              ? 'Camera permission is required to scan QR codes.'
              : 'Could not start the camera here. Use “Scan QR image” instead.',
          );
        }
      }
    })();

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <Box sx={{ mt: 2 }}>
      <Box
        sx={{
          position: 'relative',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: '#000',
          width: '100%',
          maxWidth: 520,
          aspectRatio: '4/3',
        }}
      >
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* Scan-frame guide */}
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 200,
            height: 200,
            transform: 'translate(-50%, -50%)',
            border: '2px solid rgba(255,255,255,0.85)',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
        {starting && !err && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <CircularProgress size={28} />
          </Box>
        )}
      </Box>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {err ? <Alert severity="warning" sx={{ mt: 1.5 }}>{err}</Alert> : null}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Point the camera at a product's QR code — scanning pauses automatically once a tag is identified.
      </Typography>
    </Box>
  );
}

export default function ScanStockPage({ onLogout }) {
  usePageTitle('/scan-stock');
  const fileRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  // Paste fallback: every printed tag also carries its payload as plain text
  // under the QR box — typing it resolves the product when the camera or a
  // photo refuses to decode (glare, damage, worn print).
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null); // QrProductLookup payload
  // Verify-and-confirm state: counted quantity per location, transaction type,
  // transfer destination/reason, and submission feedback. Nothing touches
  // official stock directly — every submission becomes a PENDING request the
  // owner approves, so a scan can never silently overwrite inventory.
  const [counts, setCounts] = useState({});
  const [txType, setTxType] = useState('adjustment');
  const [dstLocation, setDstLocation] = useState('');
  const [reason, setReason] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState('');
  const [confirmErr, setConfirmErr] = useState('');
  const [locIdByName, setLocIdByName] = useState({});

  // Location list once, so corrections/transfers address the right area by id.
  useEffect(() => {
    apiGet('/api/locations')
      .then((data) => {
        const list = Array.isArray(data) ? data : (data && data.data) || [];
        const map = {};
        list.forEach((l) => {
          if (l && l.id && l.name) map[l.name] = l.id;
        });
        setLocIdByName(map);
      })
      .catch(() => {});
  }, []);

  const reset = () => {
    setResult(null);
    setError('');
    setNotice('');
    setCounts({});
    setReason('');
    setTxType('adjustment');
    setDstLocation('');
    setConfirmMsg('');
    setConfirmErr('');
  };

  // A decoded string from the live camera or the uploaded QR image.
  const handleDecoded = async (raw) => {
    const rawCode = String(raw || '').trim();
    // Camera-friendly printed tags arrive as the tag URL (https://…/t/<code>):
    // unwrap to the plain payload so routing and the audit trail treat it
    // exactly like INVENTRAK:PROD:<id>.
    const urlTag = rawCode.match(/^https:\/\/[^\s/]+\/t\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/i);
    const code = urlTag ? urlTag[1] : rawCode;
    if (!code || busy) return;
    setScanning(false); // pause scanning while the transaction is processed
    setError('');
    setNotice('');
    setResult(null);

    // Location tags are routed, not looked up: they name a storage area for
    // transfers/counts, not a product.
    const locTag = code.match(LOC_TAG_RE);
    if (locTag) {
      let name = locTag[2];
      try {
        name = decodeURIComponent(name);
      } catch {
        /* keep the raw value */
      }
      logScanEvent(code, 'location', Number(locTag[1]));
      setNotice(`This is a location tag for “${name}” — location tags identify a storage area. Open the Inventory page to view that area's stock, or scan a product tag to record a count.`);
      return;
    }

    setBusy(true);
    try {
      const productTag = code.match(PROD_TAG_RE);
      const codeParam = productTag ? productTag[1] : code;
      // Unknown/foreign codes are logged too — exactly the scans worth being
      // able to review in the audit trail later.
      logScanEvent(code, productTag ? 'product' : 'unknown', null);
      const data = await getProductByQr({ code: codeParam });
      if (!data || !data.product) throw new Error('Unexpected response from the product lookup.');
      setResult(data);
      // Prefill the count form with the current quantities.
      const next = {};
      Object.keys(data.stock?.locations || {}).forEach((k) => {
        next[k] = data.stock.locations[k];
      });
      setCounts(next);
      setTxType('adjustment');
      setDstLocation('');
      setReason('');
      setConfirmMsg('');
      setConfirmErr('');
    } catch (err) {
      const status = err && err.status;
      if (status === 400) setError('Invalid QR code. Please scan a valid INVENTRAK QR code.');
      else if (status === 404) setError('QR code is not registered in INVENTRAK.');
      else if (status === 409) setError('This product is currently inactive.');
      else if (status === 401 || status === 403) setError('You are not authorized to perform this inventory action.');
      else setError('Unable to retrieve product information. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  // Fallback for browsers without a camera: upload a photo of the QR tag and
  // decode it from the still image (same jsQR decoder).
  const pick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        // Composite onto an opaque white backing BEFORE decoding: photos of
        // tags and some generated PNGs carry alpha, and transparent pixels
        // binarize unpredictably — a tag that decodes on paper can then fail
        // here. White matches printed paper.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let code = null;
        try {
          code = jsQR(imageData.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
        } catch {
          code = null;
        }
        setBusy(false);
        if (code && code.data) {
          handleDecoded(code.data);
        } else {
          setError(
            'No QR code found in the image. Try a sharper, well-lit photo of the tag — or use “Paste payload” to type the code printed under the QR.',
          );
          setPasteOpen(true);
        }
      };
      img.onerror = () => {
        setBusy(false);
        setError('Could not read that image file.');
      };
      img.src = String(reader.result || '');
    };
    reader.onerror = () => {
      setBusy(false);
      setError('Could not read that image file.');
    };
    reader.readAsDataURL(file);
  };

  const top = result;
  const locs = top ? Object.keys(top.stock?.locations || {}) : [];
  const locationNames = Object.keys(locIdByName);

  const submitTransaction = async () => {
    if (!top) return;
    const changes = locs.filter((loc) => {
      const current = Number(top.stock?.locations?.[loc]) || 0;
      const next = Number(counts[loc]);
      return Number.isFinite(next) && next >= 0 && next !== current;
    });

    if (txType === 'transfer') {
      const qty = Number(counts.__transferQty);
      const srcName = locs[0] || Object.keys(locIdByName)[0];
      const srcId = locIdByName[srcName];
      const dstId = locIdByName[dstLocation];
      if (!Number.isFinite(qty) || qty <= 0) {
        setConfirmErr('Enter the quantity to transfer.');
        return;
      }
      if (!dstId) {
        setConfirmErr('Choose the destination storage area.');
        return;
      }
      if (dstId === srcId) {
        setConfirmErr('Source and destination must differ.');
        return;
      }
      setConfirmBusy(true);
      setConfirmMsg('');
      setConfirmErr('');
      try {
        await createStockTransfer({
          product_id: Number(top.product.id),
          src_location: Number(srcId),
          dst_location: Number(dstId),
          qty,
          reason: reason.trim() || `Transfer from QR scan of ${top.product.name}`,
        });
        setConfirmMsg('Transfer submitted — PENDING APPROVAL. Stock moves after the owner approves.');
        setReason('');
      } catch (err) {
        setConfirmErr(err?.body?.details?.join(' · ') || err?.message || 'Could not submit the transfer. Try again.');
      } finally {
        setConfirmBusy(false);
      }
      return;
    }

    if (changes.length === 0) {
      setConfirmErr('No changes — enter a counted quantity that differs from the current count.');
      setConfirmMsg('');
      return;
    }
    setConfirmBusy(true);
    setConfirmMsg('');
    setConfirmErr('');
    const failures = [];
    let done = 0;
    for (const loc of changes) {
      const locationId = locIdByName[loc];
      if (!locationId) {
        failures.push(loc);
        continue;
      }
      try {
        await createStockAdjustment({
          product_id: Number(top.product.id),
          location_id: Number(locationId),
          new_qty: Number(counts[loc]),
          reason: reason.trim() || `Physical count from QR scan of ${top.product.name}`,
        });
        done += 1;
      } catch (err) {
        failures.push(loc);
      }
    }
    setConfirmBusy(false);
    if (done > 0) {
      setConfirmMsg(
        `${done} transaction(s) submitted — PENDING APPROVAL. Official stock updates after the owner approves.` +
          (failures.length > 0 ? ` Failed: ${failures.join(', ')}.` : ''),
      );
      setReason('');
    } else {
      setConfirmErr('Could not submit. Check the product/locations and try again.');
    }
  };

  return (
    <AdminLayout title="Scan & Stock" onLogout={onLogout}>
      <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <div>
            <Typography variant="h6">Scan a product QR code</Typography>
            <Typography variant="body2" color="text.secondary">
              QR identifies the product; you verify the physical count and submit it for approval — the
              owner approves before official stock updates.
            </Typography>
          </div>
          {!result ? (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                startIcon={<VideocamOutlined />}
                onClick={() => {
                  setError('');
                  setNotice('');
                  setScanning((v) => !v);
                }}
                disabled={busy}
                sx={{ backgroundColor: colors.brandPrimary }}
              >
                {scanning ? 'Stop camera' : 'Start QR camera'}
                <QrCode2Outlined sx={{ ml: 1, opacity: 0.8 }} />
              </Button>
              <Button variant="outlined" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
                Scan QR image
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  setError('');
                  setNotice('');
                  setPasteOpen((v) => !v);
                }}
                disabled={busy}
              >
                Paste payload
              </Button>
            </Box>
          ) : (
            <Button variant="outlined" startIcon={<ReplayOutlined />} onClick={reset}>
              Scan another
            </Button>
          )}
        </Box>

        {/* The scanner unmounts on a hit (camera released = scan paused) and
            remounts when the operator starts it again. */}
        {scanning && <QrScanner onDecode={handleDecoded} />}
        {/* Paste fallback: the payload text printed under each tag resolves
            exactly like a scan (same handler, same audit trail). */}
        {pasteOpen && !result && (
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', maxWidth: 520 }}>
            <TextField
              size="small"
              label="Tag payload (e.g. INVENTRAK:PROD:1)"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pasteValue.trim()) {
                  handleDecoded(pasteValue.trim());
                  setPasteValue('');
                }
              }}
              sx={{ flex: 1, minWidth: 240, backgroundColor: colors.surface }}
            />
            <Button
              variant="contained"
              disabled={busy || !pasteValue.trim()}
              onClick={() => {
                handleDecoded(pasteValue.trim());
                setPasteValue('');
              }}
              sx={{ backgroundColor: colors.brandPrimary }}
            >
              Resolve
            </Button>
          </Box>
        )}
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
            <Typography variant="body2">Product identified — retrieving details…</Typography>
          </Box>
        )}
        {notice && <Alert severity="info" sx={{ mt: 2 }}>{notice}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Paper>

      {top && (
        <Paper sx={{ p: 3, backgroundColor: colors.surfaceAlt }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
            {top.product.image ? (
              <Box
                component="img"
                src={imageUrl(top.product.image)}
                alt={top.product.name}
                sx={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 2, backgroundColor: colors.surface }}
              />
            ) : (
              <Box sx={{ width: 84, height: 84, borderRadius: 2, backgroundColor: colors.surface }} />
            )}
            <Box>
              <Typography variant="h6">{top.product.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {top.qr?.sku} · {top.product.category || 'Uncategorized'}
                {top.product.unit ? ` · ${top.product.unit}` : ''}
                {top.product.price != null ? ` · P${top.product.price}` : ''}
              </Typography>
              <Chip
                size="small"
                color={STATUS_META[top.stock?.status]?.color}
                label={`${STATUS_META[top.stock?.status]?.label || 'Unknown'} · ${top.stock?.total ?? 0} total`}
                sx={{ mt: 1 }}
              />
            </Box>
          </Box>

          <Table size="small" sx={{ maxWidth: 520 }}>
            <TableHead>
              <TableRow>
                <TableCell>Location</TableCell>
                <TableCell align="right">Current</TableCell>
                <TableCell align="right" sx={{ width: 140 }}>Counted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {locs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>No stock recorded — enter your count below.</TableCell>
                </TableRow>
              ) : (
                locs.map((loc) => (
                  <TableRow key={loc}>
                    <TableCell>{loc}</TableCell>
                    <TableCell align="right">
                      <strong>{top.stock.locations[loc] ?? 0}</strong>
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="text"
                        inputMode="decimal"
                        value={counts[loc] ?? ''}
                        onChange={(e) => setCounts({ ...counts, [loc]: e.target.value.replace(/[^0-9.]/g, '') })}
                        sx={{ width: 120, backgroundColor: colors.surface }}
                        aria-label={`Counted quantity in ${loc}`}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Verify & record — the capstone requirement: the staff member
              reviews the identified product, enters the physically counted
              quantity, and submits. Every change becomes a PENDING adjustment
              (owner-approval queue); nothing is applied to stock directly. */}
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px dashed rgba(0,0,0,0.15)' }}>
            <Typography variant="h6" sx={{ mb: 0.5 }}>Verify & record inventory transaction</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Enter the actual counted quantity per storage area, choose the transaction type, and submit.
              Submissions stay pending until the owner approves — QR never applies stock on its own.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
              <TextField
                size="small"
                select
                label="Transaction"
                value={txType}
                onChange={(e) => setTxType(e.target.value)}
                SelectProps={{ native: true }}
                sx={{ minWidth: 200, backgroundColor: colors.surface }}
              >
                <option value="adjustment">Physical count (adjustment)</option>
                <option value="transfer">Transfer between locations</option>
              </TextField>
              {txType === 'transfer' && (
                <>
                  <TextField
                    size="small"
                    type="text"
                    inputMode="decimal"
                    label="Transfer qty"
                    value={counts.__transferQty ?? ''}
                    onChange={(e) => setCounts({ ...counts, __transferQty: e.target.value.replace(/[^0-9.]/g, '') })}
                    sx={{ width: 130, backgroundColor: colors.surface }}
                  />
                  <TextField
                    size="small"
                    select
                    label="Destination"
                    value={dstLocation}
                    onChange={(e) => setDstLocation(e.target.value)}
                    SelectProps={{ native: true }}
                    sx={{ minWidth: 190, backgroundColor: colors.surface }}
                  >
                    <option value="">Select destination…</option>
                    {locationNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </TextField>
                </>
              )}
              <TextField
                size="small"
                label="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                sx={{ minWidth: 220, flex: 1, backgroundColor: colors.surface }}
              />
              <Button
                variant="contained"
                color="secondary"
                onClick={submitTransaction}
                disabled={confirmBusy || !top}
                sx={{ backgroundColor: colors.brandSecondary }}
              >
                {confirmBusy ? 'Submitting…' : 'Submit for approval'}
              </Button>
            </Box>
            {confirmMsg ? <Alert severity="success" sx={{ mt: 1.5 }}>{confirmMsg}</Alert> : null}
            {confirmErr ? <Alert severity="error" sx={{ mt: 1.5 }}>{confirmErr}</Alert> : null}
          </Box>

          {/* Open FIFO/FEFO lots — the expiry info staff need while counting
              perishable stock (consume soonest expiry first). */}
          {top.lots && top.lots.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Open lots (FEFO order — consume soonest expiry first)
              </Typography>
              {top.lots.map((lot) => (
                <Box
                  key={lot.id ?? `${lot.product_id}-${lot.location_id}-${lot.received_at}`}
                  sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1 }}
                >
                  <Typography variant="body2">
                    {lot.location_name || `Location ${lot.location_id}`} · qty {lot.qty}
                    {lot.expiry_date ? ` · best before ${lot.expiry_date}` : ' · no expiry'}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          <Divider sx={{ mt: 3, mb: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Scanned as {top.qr?.payload} — every scan is recorded in the audit trail.
          </Typography>
        </Paper>
      )}
    </AdminLayout>
  );
}
