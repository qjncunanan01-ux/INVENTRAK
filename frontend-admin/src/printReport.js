/**
 * Shared print helper for every printable surface (reports, QR tags).
 *
 * Why this exists: the old approach was one global print CSS rule that
 * revealed ONLY `#qr-tag-sheet` — so "Print / Save PDF" on Reports (and the
 * single product-tag dialog) printed blank paper: every element was hidden
 * and nothing ever revealed them.
 *
 * The mechanism: the caller marks ONE element with data-print-root; the
 * global @media print CSS in index.css hides everything else (body *) and
 * reveals just that subtree. visibility (unlike display) lets the revealed
 * subtree print at its natural layout position, which is all a print of a
 * page region needs. The marker is cleared on `afterprint`, so a cancelled
 * print never leaves stale state behind.
 *
 * Returns a cleanup function (idempotent) for callers that want to clear the
 * marker themselves, e.g. in a finally block.
 */
export function printElement(el) {
  if (!el || !document.body.contains(el)) return () => {};

  const previous = el.querySelector('[data-print-root]');
  if (previous && previous !== el) previous.removeAttribute('data-print-root');

  el.setAttribute('data-print-root', '');
  const cleanup = () => el.removeAttribute('data-print-root');

  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  return cleanup;
}
