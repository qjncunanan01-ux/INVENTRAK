import { describe, expect, it } from 'vitest';
import {
  RECONCILIATION_FORMULA, caveats, describeRow, headline, peso, rowTone,
} from './reconciliation';

// The panel's TEXT is the claim. If it says "3 units unaccounted for", the
// number came from the backend's arithmetic — but the wording around it is
// written here, and wording is where a report starts accusing people.

describe('rowTone', () => {
  it('never dresses a loss up as neutral', () => {
    expect(rowTone({ classification: 'loss' }).label).toBe('Unaccounted');
    expect(rowTone({ classification: 'loss' }).color).toBe('error');
    expect(rowTone({ classification: 'overage' }).label).toBe('Found stock');
    expect(rowTone({ classification: 'balanced' }).label).toBe('Balanced');
    expect(rowTone(null).label).toBe('Balanced');
  });
});

describe('describeRow', () => {
  const loss = {
    counted_qty: 100, system_qty_at_count: 100, sales_since_count: 5,
    expected_qty_now: 95, system_qty_now: 98, unexplained_qty: 3,
    variance_at_count: 0, classification: 'loss',
  };

  it('walks the arithmetic out in words', () => {
    const text = describeRow(loss);
    expect(text).toContain('Counted 100');
    expect(text).toContain('5 recorded sale');
    expect(text).toContain('98');
    expect(text).toContain('3 unit');
  });

  it('says "cannot account for", never names a cause', () => {
    // Theft, breakage and a till error are indistinguishable from this data.
    const text = describeRow(loss).toLowerCase();
    for (const word of ['steal', 'theft', 'stolen', 'thief', 'shoplift', 'fraud']) {
      expect(text).not.toContain(word);
    }
    expect(text).toContain('cannot account for');
  });

  it('calls an overage found stock, explicitly not a loss', () => {
    const text = describeRow({ ...loss, unexplained_qty: -4, classification: 'overage' });
    expect(text).toContain('found stock, not a loss');
  });

  it('separates the variance FOUND at the count from what happened since', () => {
    // Two different facts, and conflating them is how a report talks itself
    // into blaming someone for a discrepancy that predates them.
    const text = describeRow({ ...loss, variance_at_count: -10, unexplained_qty: 0, classification: 'balanced' });
    expect(text).toContain('short by 10');
    expect(text).toContain('It adds up');
  });

  it('rounds to whole units and keeps a genuine fraction', () => {
    expect(describeRow({ ...loss, unexplained_qty: 2.0001 })).toContain('2 units');
    expect(describeRow({ ...loss, unexplained_qty: 2.5 })).toContain('2.5 units');
  });

  it('survives a junk row', () => {
    expect(describeRow(null)).toBe('');
    expect(typeof describeRow({})).toBe('string');
  });
});

describe('headline', () => {
  it('does not read as "no shrinkage" before anything is counted', () => {
    // The most dangerous version of this report is an empty one that looks
    // clean. It must say what is missing instead.
    const text = headline({ counted_rows: 0 });
    expect(text).toContain('No shelves counted yet');
  });

  it('says so plainly when everything balances', () => {
    const text = headline({ counted_rows: 4, losses: 0, overages: 0, shrinkage_units: 0, value_at_risk: 0 });
    expect(text).toContain('every one balances');
  });

  it('counts losses and overages separately', () => {
    const text = headline(
      { counted_rows: 6, losses: 2, overages: 1, shrinkage_units: 7, overage_units: 3, value_at_risk: 1400 },
      2,
    );
    expect(text).toContain('2 unaccounted');
    expect(text).toContain('7 units');
    expect(text).toContain('₱1,400');
    expect(text).toContain('1 over-counted');
    expect(text).toContain('across 2 locations');
  });
});

describe('caveats', () => {
  it('always states the location limitation and the no-cause limitation', () => {
    const notes = caveats({ counted_rows: 1 });
    const text = notes.join(' ').toLowerCase();
    expect(text).toContain('sales carry no location');
    expect(text).toContain('does not say why');
  });

  it('surfaces counts it could not fully reconcile', () => {
    const notes = caveats({ counted_rows: 3, undated_counts: 1, incomplete_sales_rows: 2 }).join(' ');
    expect(notes).toContain('no usable timestamp');
    expect(notes).toContain('unreadable timestamp');
  });

  it('does not invent caveats when the data is clean', () => {
    const notes = caveats({ counted_rows: 3, undated_counts: 0, incomplete_sales_rows: 0 }).join(' ');
    expect(notes).not.toContain('no usable timestamp');
    expect(notes).not.toContain('unreadable timestamp');
  });
});

describe('the formula, printed on screen', () => {
  it('is the arithmetic the backend actually uses', () => {
    // Copy drift between the banner and the backend is exactly the kind of
    // thing a panel member checks, so the string is asserted.
    expect(RECONCILIATION_FORMULA).toContain('unexplained = system_now');
    expect(RECONCILIATION_FORMULA).toContain('counted');
    expect(RECONCILIATION_FORMULA).toContain('recorded sales');
  });
});

describe('peso', () => {
  it('never invents precision', () => {
    expect(peso(1400)).toBe('₱1,400');
    expect(peso(0)).toBe('₱0');
    expect(peso(null)).toBe('₱0');
    expect(peso(12.5)).toBe('₱12.5');
  });
});