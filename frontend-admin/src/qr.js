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

export function locationQrPayload(location) {
  return `${LOCATION_QR_PREFIX}${location.id}:${encodeURIComponent(location.name)}`;
}

export function productQrPayload(product) {
  return `${PRODUCT_QR_PREFIX}${product.id}`;
}

// QR images come from the same public qrserver.com endpoint the MFA page
// already uses — no new dependency and no server round-trip.
export function qrImageUrl(payload, size = 260) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`;
}

/**
 * Decode an INVENTRAK QR payload. Mirrors the mobile scanner's parseQr so the
 * admin's scan-to-stock box accepts exactly what the phone emits.
 * @returns {{kind:'location'|'product', id:number, name:string|null}|null}
 */
export function parseQrPayload(data) {
  const raw = String(data || '').trim();
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
