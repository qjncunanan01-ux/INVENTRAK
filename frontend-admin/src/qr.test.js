import { describe, expect, test } from 'vitest';
import {
  LOCATION_QR_PREFIX,
  PRODUCT_QR_PREFIX,
  locationQrPayload,
  parseQrPayload,
  productQrPayload,
  qrImageUrl,
} from './qr';

// The QR payload format is a CROSS-APP CONTRACT: mobile-client's
// QrScanScreen.parseQr must decode exactly what this module emits. These tests
// pin the format so a "harmless" rename can't silently break every printed tag.
describe('QR payload contract', () => {
  test('location payload is INVENTRAK:LOC:<id>:<encoded name>', () => {
    const payload = locationQrPayload({ id: 2, name: 'Stockroom 1' });
    expect(payload).toBe('INVENTRAK:LOC:2:Stockroom%201');
    expect(payload.startsWith(LOCATION_QR_PREFIX)).toBe(true);
  });

  test('product payload carries only the id, so a rename cannot invalidate a tag', () => {
    const payload = productQrPayload({ id: 12, name: 'Torani Strawberry' });
    expect(payload).toBe('INVENTRAK:PROD:12');
    expect(payload.startsWith(PRODUCT_QR_PREFIX)).toBe(true);
  });

  test('qrImageUrl encodes the payload into the image request', () => {
    const url = qrImageUrl('INVENTRAK:LOC:2:Stockroom%201', 200);
    expect(url).toContain('size=200x200');
    expect(url).toContain(encodeURIComponent('INVENTRAK:LOC:2:Stockroom%201'));
  });
});

describe('parseQrPayload (mirrors the mobile scanner)', () => {
  test('decodes a location tag and URL-decodes the name', () => {
    expect(parseQrPayload('INVENTRAK:LOC:2:Stockroom%201')).toEqual({
      kind: 'location',
      id: 2,
      name: 'Stockroom 1',
    });
  });

  test('decodes a product tag', () => {
    expect(parseQrPayload('INVENTRAK:PROD:12')).toEqual({ kind: 'product', id: 12, name: null });
  });

  test('is case-insensitive and trims surrounding whitespace', () => {
    expect(parseQrPayload('  inventrak:prod:7  ')).toEqual({ kind: 'product', id: 7, name: null });
  });

  test('returns null for a foreign QR code instead of guessing', () => {
    expect(parseQrPayload('https://example.com')).toBeNull();
    // A bare number is deliberately NOT accepted here: the admin's
    // scan-to-stock box must only act on tags this system printed.
    expect(parseQrPayload('12')).toBeNull();
    expect(parseQrPayload('')).toBeNull();
    expect(parseQrPayload(undefined)).toBeNull();
  });

  test('round-trips every emitted payload', () => {
    const loc = { id: 3, name: 'Showroom' };
    expect(parseQrPayload(locationQrPayload(loc))).toEqual({ kind: 'location', id: 3, name: 'Showroom' });
    expect(parseQrPayload(productQrPayload({ id: 99 }))).toEqual({ kind: 'product', id: 99, name: null });
  });
});
