// QR payload formats for INVENTRAK physical tags — a CROSS-APP CONTRACT.
// The mobile scanner (mobile-client/src/screens/QrScanScreen.js) parses these
// exact prefixes, so any change here must land there too (and in the tests).
//
//   INVENTRAK:LOC:<locationId>:<urlEncodedName>   storage-area tag
//   INVENTRAK:PROD:<productId>                    product tag
//
// Product tags carry only the id: the name/price are looked up live, so a tag
// printed last week still resolves after a rename.
export const LOCATION_QR_PREFIX = 'INVENTRAK:LOC:';
export const PRODUCT_QR_PREFIX = 'INVENTRAK:PROD:';

// Where camera-friendly tag URLs point: the public product page (GET /t/:code)
// served by the API server. Overridable per environment for local runs.
const TAG_BASE = (import.meta.env?.VITE_TAG_URL_BASE || 'https://inventrak-api.onrender.com').replace(/\/+$/, '');
const TAG_URL_RE = /^https:\/\/[^\s/]+\/t\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/;

export function locationQrPayload(location) {
  return `${LOCATION_QR_PREFIX}${location.id}:${encodeURIComponent(location.name)}`;
}

// Product tags print as the CAMERA-FRIENDLY URL form: a phone's native camera
// app opens the public product page instead of showing "No usable data found"
// for a plain-text payload. The app scanners (admin/mobile/staff) unwrap the
// URL and behave exactly as with INVENTRAK:PROD:<id> — both forms resolve.
export function productQrPayload(product) {
  return `${TAG_BASE}/t/${product.id}`;
}

// QR images are generated LOCALLY by the `qrcode` package via the
// components/QrImage.jsx component — never a network request. The previous
// qrImageUrl() helper pointed at api.qrserver.com, which sent every payload
// (printed tag ids, payment amounts, and the MFA otpauth:// secret) to a
// third-party server as a URL parameter. It was removed: call sites now render
// <QrImage payload={...} size={...} />, which also works offline.

/**
 * Decode an INVENTRAK QR payload. Mirrors the mobile scanner's parseQr so the
 * admin's scan-to-stock box accepts exactly what the phone emits.
 * @returns {{kind:'location'|'product', id:number, name:string|null}|null}
 */
export function parseQrPayload(data) {
  const raw = String(data || '').trim();
  // Camera-friendly printed tags arrive as a URL — unwrap to the plain tag
  // payload (the path segment is the product identifier) so every rule below
  // applies unchanged, including the strict "INVENTRAK tags only" policy.
  const url = raw.match(TAG_URL_RE);
  if (url) return parseQrPayload(`${PRODUCT_QR_PREFIX}${url[1]}`);
  const loc = raw.match(/^INVENTRAK:LOC:(\d+):(.+)$/i);
  if (loc) {
    let name = loc[2];
    try { name = decodeURIComponent(name); } catch { /* keep the raw value */ }
    return { kind: 'location', id: Number(loc[1]), name };
  }
  const prod = raw.match(/^INVENTRAK:PROD:(\d+)$/i);
  if (prod) return { kind: 'product', id: Number(prod[1]), name: null };
  return null;
}
