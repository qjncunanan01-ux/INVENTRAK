import { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import QR from 'qrcode';

/**
 * Renders a QR code locally with the `qrcode` package — NO network request.
 *
 * Why local rendering matters: the payload is embedded in the image URL when
 * using a public QR web service, so every payload (printed tag ids, payment
 * amounts/references, and — worst of all — the MFA setup otpauth:// secret)
 * was being sent to a third-party server. Local generation keeps the secret
 * on-device and also works offline / behind a firewall.
 *
 * Renders `fallback` (default: nothing) while generating or on error, so the
 * surrounding UI controls the loading/empty state.
 */
export default function QrImage({ payload, size = 200, fallback = null, sx }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!payload) {
      setDataUrl(null);
      return undefined;
    }
    QR.toDataURL(String(payload), {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [payload, size]);

  if (failed) return fallback;
  if (!dataUrl) {
    return fallback ?? (
      <Box sx={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', ...sx }}>
        <CircularProgress size={Math.min(28, size / 4)} />
    </Box>
    );
  }
  return <Box component="img" src={dataUrl} alt="QR code" sx={{ width: size, height: size, display: 'block', ...sx }} />;
}
