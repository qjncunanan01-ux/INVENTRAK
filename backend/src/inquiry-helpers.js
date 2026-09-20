// Attach a parsed, normalized `products_detail` array to every inquiry row so
// clients (admin + mobile) can render per-line prices without re-parsing the
// products JSON themselves. Resilient to legacy/malformed payloads.
function enrichInquiryRows(rows) {
  return rows.map((row) => {
    let parsed = [];
    try {
      const raw = JSON.parse(row.products || '[]');
      if (Array.isArray(raw)) parsed = raw;
    } catch { }
    return { ...row, products_detail: parsed };
  });
}

module.exports = { enrichInquiryRows };