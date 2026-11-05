const MAX_REFERENCE_LENGTH = 120;
const MAX_BOOKING_URL_LENGTH = 2000;

function normalizeDeliveryBooking(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const reference = typeof input.booking_reference === 'string' ? input.booking_reference.trim() : '';
  if (!reference || reference.length > MAX_REFERENCE_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9 ._#/-]*$/.test(reference)) {
    return { error: 'Enter a valid Lalamove booking reference (up to 120 letters, numbers, spaces, or . _ # / -)' };
  }

  const rawUrl = typeof input.booking_url === 'string' ? input.booking_url.trim() : '';
  if (!rawUrl) return { reference, url: null };
  if (rawUrl.length > MAX_BOOKING_URL_LENGTH) return { error: 'The Lalamove share link must be at most 2000 characters' };

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !(host === 'lalamove.com' || host.endsWith('.lalamove.com'))) {
      return { error: 'Use an HTTPS Lalamove share link' };
    }
    return { reference, url: parsed.toString() };
  } catch {
    return { error: 'Enter a valid HTTPS Lalamove share link' };
  }
}

module.exports = { normalizeDeliveryBooking };
