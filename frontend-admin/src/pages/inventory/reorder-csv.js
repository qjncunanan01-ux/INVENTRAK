function csvCell(value) {
  let text = String(value ?? '');
  // Prevent spreadsheet formula injection from catalog names or text fields.
  let firstVisible = 0;
  while (firstVisible < text.length && (text[firstVisible].trim() === '' || text.charCodeAt(firstVisible) <= 0x1f)) {
    firstVisible += 1;
  }
  if ('=+-@'.includes(text[firstVisible])) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildReorderCsv(items) {
  const rows = [
    ['Product', 'On hand', 'Critical level', 'Reorder point', 'Safety stock', 'Suggested quantity', 'Recommendation'],
    ...(Array.isArray(items) ? items : []).map((item) => [
      item.product_name,
      item.on_hand,
      item.critical_level,
      item.reorder_point,
      item.safety_stock,
      item.recommended_quantity ?? 'Manual review required',
      item.recommendation_basis === 'eoq' ? 'EOQ estimate; confirm supplier terms' : 'No recent demand; set quantity manually',
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}
