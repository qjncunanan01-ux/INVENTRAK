import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import QrImage from './QrImage';
import { locationQrPayload, productQrPayload } from '../qr';

// One tag on the printable sheet: the QR image plus a human-readable caption so
// a printed page can still be filed or matched by eye.
function Tag({ payload, caption, sub }) {
  return (
    <Box
      sx={{
        border: '1px solid #cfd8c5',
        borderRadius: 2,
        p: 1.5,
        textAlign: 'center',
        breakInside: 'avoid',
        pageBreakInside: 'avoid',
      }}
    >
      {/* Local QR generation — the payload never leaves this machine. */}
      <QrImage payload={payload} size={140} sx={{ margin: '0 auto' }} />
      <Typography variant="subtitle2" sx={{ mt: 1, fontWeight: 800, lineHeight: 1.2 }}>
        {caption}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
        {sub}
      </Typography>
    </Box>
  );
}

/**
 * Batch-print sheet for the Showroom / Stockroom tags. Renders every location
 * tag and (optionally) product tags in one print-friendly page — the operator
 * uses the browser's Print → Save as PDF. `@media print` rules in index.css
 * hide the rest of the app so only the sheet lands on paper.
 */
export default function QrTagSheet({ open, onClose, locations = [], products = [], includeProducts = true }) {
  const hasTags = locations.length > 0 || (includeProducts && products.length > 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Printable QR tag sheet
        <Typography variant="body2" color="text.secondary">
          {locations.length} location tag(s)
          {includeProducts ? ` · ${products.length} product tag(s)` : ''}
          {' — '}print or save as PDF, then cut and attach.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {!hasTags ? (
          <Typography color="text.secondary">Nothing to print yet.</Typography>
        ) : (
          <Box
            id="qr-tag-sheet"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 2,
            }}
          >
            {locations.map((loc) => (
              <Tag
                key={`loc-${loc.id}`}
                payload={locationQrPayload(loc)}
                caption={loc.name}
                sub={locationQrPayload(loc)}
              />
            ))}
            {includeProducts
              ? products.map((product) => (
                <Tag
                  key={`prod-${product.id}`}
                  payload={productQrPayload(product)}
                  caption={product.name}
                  sub={productQrPayload(product)}
                />
              ))
              : null}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" color="secondary" onClick={() => window.print()} disabled={!hasTags}>
          🖨 Print sheet
        </Button>
      </DialogActions>
    </Dialog>
  );
}
