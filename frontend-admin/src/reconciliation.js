// Pure helpers for the shelf-vs-system reconciliation panel.
//
// Kept out of the component for the same reason as till.js: the wording is a
// CLAIM to the operator. If the panel says "3 units unaccounted for" the
// number underneath had better come from the same arithmetic the backend used,
// and the FormulaBanner has to print that arithmetic rather than a slogan.

// One line stating the exact formula, shown beside its own output so the
// number is defensible without opening a file.
export const RECONCILIATION_FORMULA =
  'unexplained = system_now − (counted − recorded sales since the count)';

// The plain-language reading of a row. Deliberately says "unaccounted for",
// NOT "stolen" or "lost to theft": from this data a missing unit is
// indistinguishable between breakage, a till error and theft, and naming a
// cause would be the report inventing an accusation.
// Proper pluralisation. "unit(s)" reads as a template that never decided,
// and this is the sentence an operator reads when deciding whether to worry.
function plural(n, one, many) {
  return Math.abs(n - 1) < 0.001 ? one : many;
}

export function describeRow(row) {
  if (!row) return '';
  const unexplained = Number(row.unexplained_qty) || 0;
  const found = Number(row.variance_at_count) || 0;
  const parts = [];

  if (Math.abs(unexplained) < 0.001) {
    parts.push(`Counted ${row.counted_qty}; ${row.sales_since_count} sold through the till; system now says ${row.system_qty_now}. It adds up.`);
  } else if (unexplained > 0) {
    parts.push(`Counted ${row.counted_qty}; ${row.sales_since_count} recorded ${plural(row.sales_since_count, 'sale', 'sales')} since; system still shows ${row.system_qty_now}. That leaves ${round(unexplained)} ${plural(unexplained, 'unit', 'units')} the shelf cannot account for.`);
  } else {
    parts.push(`Counted ${row.counted_qty}; ${row.sales_since_count} recorded ${plural(row.sales_since_count, 'sale', 'sales')} since; system shows ${row.system_qty_now}, which is ${round(Math.abs(unexplained))} below the ${row.expected_qty_now} the shelf should hold — found stock, not a loss.`);
  }

  if (Math.abs(found) >= 0.001) {
    const dir = found < 0 ? 'short' : 'over';
    parts.push(`At the count the system said ${row.system_qty_at_count} — ${dir} by ${round(Math.abs(found))}.`);
  }
  return parts.join(' ');
}

// Chip label + colour per classification.
export function rowTone(row) {
  const c = row && row.classification;
  if (c === 'loss') return { label: 'Unaccounted', color: 'error' };
  if (c === 'overage') return { label: 'Found stock', color: 'info' };
  return { label: 'Balanced', color: 'default' };
}

// Peso formatting that never invents precision the data lacks.
export function peso(n) {
  const v = Number(n) || 0;
  return `₱${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function round(n) {
  const v = Number(n) || 0;
  return Math.abs(v - Math.round(v)) < 0.001 ? Math.round(v) : Number(v.toFixed(2));
}

// The headline sentence. Says what is counted so far, because a report with
// no counts yet must not read as "no shrinkage" — it reads as "nothing counted".
export function headline(summary, countedLocations) {
  if (!summary || !summary.counted_rows) {
    return 'No shelves counted yet. Walk a shelf and record what you see — the report compares it against the system and the till.';
  }
  const s = summary;
  if (!s.losses && !s.overages) {
    return `${s.counted_rows} shelf line${s.counted_rows === 1 ? '' : 's'} counted · every one balances against the system and the till.`;
  }
  const bits = [`${s.counted_rows} shelf line${s.counted_rows === 1 ? '' : 's'} counted`];
  if (s.losses) bits.push(`${s.losses} unaccounted (${round(s.shrinkage_units)} units, ${peso(s.value_at_risk)})`);
  if (s.overages) bits.push(`${s.overages} over-counted (${round(s.overage_units)} units found)`);
  if (countedLocations) bits.push(`across ${countedLocations} location${countedLocations === 1 ? '' : 's'}`);
  return bits.join(' · ') + '.';
}

// What the report does NOT establish, said on screen. A number without its
// limits invites the reader to assume more than the data supports.
export function caveats(summary) {
  const notes = [];
  if (summary && summary.undated_counts) {
    notes.push(`${summary.undated_counts} count(s) have no usable timestamp, so they cannot be checked against sales.`);
  }
  if (summary && summary.incomplete_sales_rows) {
    notes.push(`${summary.incomplete_sales_rows} count(s) have sales with an unreadable timestamp; their figures are incomplete.`);
  }
  notes.push('Sales carry no location, so a count at one shelf is checked against every recorded sale of that product.');
  notes.push('This reports units unaccounted for. It does not say why — breakage, a till error and theft look identical here.');
  return notes;
}