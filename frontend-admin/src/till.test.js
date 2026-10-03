import { describe, expect, it } from 'vitest';
import {
  consumedTotal, daysToExpiry, describeConsumedLot, describeConsumedLots,
  describeLowStock, expiryTone, fefoOrder, nextLotToConsume, previewTotal,
} from './till';

// The till's helpers decide WHAT THE STAFF MEMBER IS TOLD. That makes them
// worth testing on their own: the component suite only proves the strings
// reach the screen, not that the strings are true.
//
// The load-bearing one is fefoOrder. The backend consumes lots expiring-first
// (stock-movement-helpers.consumeStockLots); this sort has to agree. If the two
// disagree the screen promises the expiring batch leaves and the server takes a
// different one — a UI that lies about FEFO is worse than no display at all.

const NOW = new Date(2026, 9, 3); // 3 Oct 2026, local

const lot = (id, qty, expiry, received = '2026-01-01T00:00:00.000Z') => ({
  id, qty, expiry_date: expiry, received_at: received,
});

describe('fefoOrder', () => {
  it('puts the soonest expiry first', () => {
    const ordered = fefoOrder([
      lot(3, 10, '2027-05-01'),
      lot(1, 10, '2026-11-01'),
      lot(2, 10, '2027-01-15'),
    ]);
    expect(ordered.map(l => l.id)).toEqual([1, 2, 3]);
  });

  it('sends non-expiring stock last, however old it is', () => {
    // FIFO is only the tiebreak WITHIN a group. An undated lot received in
    // January must not jump ahead of a batch expiring next month.
    const ordered = fefoOrder([
      lot(1, 5, null, '2026-01-01T00:00:00.000Z'),
      lot(2, 5, '2026-12-01'),
    ]);
    expect(ordered.map(l => l.id)).toEqual([2, 1]);
  });

  it('breaks ties on arrival, then on id — a total, stable order', () => {
    const ordered = fefoOrder([
      lot(9, 1, '2026-12-01', '2026-06-01'),
      lot(7, 1, '2026-12-01', '2026-03-01'),
    ]);
    expect(ordered.map(l => l.id)).toEqual([7, 9]);

    const sameDay = fefoOrder([lot(5, 1, '2026-12-01', '2026-03-01'), lot(4, 1, '2026-12-01', '2026-03-01')]);
    expect(sameDay.map(l => l.id)).toEqual([4, 5]);
  });

  it('ignores empty lots and junk input', () => {
    expect(fefoOrder([lot(1, 0, '2026-12-01'), lot(2, 5, '2026-11-01')]).map(l => l.id)).toEqual([2]);
    expect(fefoOrder(null)).toEqual([]);
    expect(fefoOrder(undefined)).toEqual([]);
    expect(fefoOrder([null, undefined])).toEqual([]);
  });
});

describe('nextLotToConsume', () => {
  it('names the batch that leaves first and how much of it', () => {
    const next = nextLotToConsume([lot(1, 10, '2026-12-01'), lot(2, 10, '2027-01-01')], 3);
    expect(next.lot.id).toBe(1);
    expect(next.qty).toBe(3);
    expect(next.spillsOver).toBe(false);
  });

  it('flags a sale that spans more than one batch', () => {
    // Only 2 units of the expiring lot: a sale of 3 must consume it AND the
    // next one. Saying so before the sale is the point of the preview.
    const next = nextLotToConsume([lot(1, 2, '2026-12-01'), lot(2, 10, '2027-01-01')], 3);
    expect(next.lot.id).toBe(1);
    expect(next.qty).toBe(2);
    expect(next.spillsOver).toBe(true);
  });

  it('returns null when there is nothing to take', () => {
    expect(nextLotToConsume([], 3)).toBeNull();
    expect(nextLotToConsume([lot(1, 0, '2026-12-01')], 3)).toBeNull();
    expect(nextLotToConsume([lot(1, 5, '2026-12-01')], 0)).toBeNull();
    expect(nextLotToConsume([lot(1, 5, '2026-12-01')], -1)).toBeNull();
    expect(nextLotToConsume([lot(1, 5, '2026-12-01')], 'abc')).toBeNull();
  });
});

describe('daysToExpiry', () => {
  it('counts whole calendar days, forward and backward', () => {
    expect(daysToExpiry('2026-10-03', NOW)).toBe(0);
    expect(daysToExpiry('2026-10-13', NOW)).toBe(10);
    expect(daysToExpiry('2026-09-23', NOW)).toBe(-10);
  });

  it('does not shift a day across timezones', () => {
    // toISOString() would move a local midnight to the previous day in
    // UTC+8, so an evening entry would read as expiring "tomorrow".
    expect(daysToExpiry('2026-10-04', new Date(2026, 9, 3, 23, 30))).toBe(1);
  });

  it('returns null for absent or unparseable dates', () => {
    expect(daysToExpiry(null, NOW)).toBeNull();
    expect(daysToExpiry(undefined, NOW)).toBeNull();
    expect(daysToExpiry('', NOW)).toBeNull();
    expect(daysToExpiry('soon', NOW)).toBeNull();
  });
});

describe('expiryTone', () => {
  it('bands by urgency with the 30-day boundary', () => {
    expect(expiryTone('2026-10-03', NOW)).toBe('expired');   // today
    expect(expiryTone('2026-09-28', NOW)).toBe('expired');   // past
    expect(expiryTone('2026-10-30', NOW)).toBe('soon');     // 27d
    expect(expiryTone('2026-11-02', NOW)).toBe('soon');     // exactly 30d
    expect(expiryTone('2026-11-03', NOW)).toBe('later');    // 31d — past the boundary
    expect(expiryTone('2026-11-20', NOW)).toBe('later');
    expect(expiryTone(null, NOW)).toBe('none');
  });

  it('treats exactly 30 days out as "soon" and 31 as "later"', () => {
    expect(expiryTone('2026-11-02', NOW)).toBe('soon');
    expect(expiryTone('2026-11-03', NOW)).toBe('later');
  });
});

describe('describeConsumedLot', () => {
  it('labels a dated lot with its batch and countdown', () => {
    const d = describeConsumedLot({ lot_id: 7, qty: 2, expiry_date: '2026-10-13', received_at: '2026-01-01' }, NOW);
    expect(d.batch).toBe('Lot #7');
    expect(d.qty).toBe(2);
    expect(d.expiryLabel).toBe('expires in 10d');
    expect(d.tone).toBe('soon');
    expect(d.unbatched).toBe(false);
  });

  it('says "unbatched" rather than inventing a batch number', () => {
    // The backend's legacy/overflow remainder carries lot_id null. Showing a
    // made-up batch here would be the one thing the till must never do.
    const d = describeConsumedLot({ lot_id: null, qty: 3, expiry_date: null }, NOW);
    expect(d.batch).toBe('Unbatched stock');
    expect(d.unbatched).toBe(true);
    expect(d.expiryLabel).toBe('no expiry date');
    expect(d.tone).toBe('none');
  });

  it('flags an expired batch as expired', () => {
    // 1 Sep -> 3 Oct is 32 days, so the label counts the real gap.
    const d = describeConsumedLot({ lot_id: 2, qty: 1, expiry_date: '2026-09-01' }, NOW);
    expect(d.tone).toBe('expired');
    expect(d.expiryLabel).toBe('expired 32d ago');
  });

  it('survives a junk entry', () => {
    expect(describeConsumedLot(null, NOW)).toBeNull();
    expect(describeConsumedLot({}, NOW).qty).toBe(0);
  });

  it('respects an injected "now" rather than the real clock', () => {
    // Without threading `now` through, these labels would drift every midnight
    // and no assertion about them could be trusted.
    const entry = { lot_id: 1, qty: 1, expiry_date: '2026-10-13' };
    expect(describeConsumedLot(entry, NOW).expiryLabel).toBe('expires in 10d');
    expect(describeConsumedLot(entry, new Date(2026, 9, 20)).expiryLabel).toBe('expired 7d ago');
  });
});

describe('describeConsumedLots + consumedTotal', () => {
  const manifest = [
    { lot_id: 1, qty: 2, expiry_date: '2026-10-10', received_at: '2026-01-01' },
    { lot_id: 2, qty: 3, expiry_date: '2026-12-01', received_at: '2026-02-01' },
  ];

  it('describes every entry in the order the server returned them', () => {
    const d = describeConsumedLots(manifest, NOW);
    expect(d.map(x => x.lot_id)).toEqual([1, 2]);
    expect(d[0].expiryLabel).toBe('expires in 7d');
  });

  it('sums the manifest — this is what the "agree" line on the receipt asserts', () => {
    expect(consumedTotal(manifest)).toBe(5);
  });

  it('handles an empty or missing manifest', () => {
    expect(describeConsumedLots([])).toEqual([]);
    expect(describeConsumedLots(null)).toEqual([]);
    expect(consumedTotal(null)).toBe(0);
    expect(consumedTotal([{ qty: 'x' }, { qty: 4 }])).toBe(4);
  });
});

describe('previewTotal', () => {
  it('multiplies quantity by the catalog price', () => {
    expect(previewTotal(3, 1070)).toBe(3210);
    expect(previewTotal(1, 45.5)).toBe(45.5);
  });

  it('rounds to cents so a float artefact never shows as a peso', () => {
    expect(previewTotal(3, 10.005)).toBe(30.02);
    expect(previewTotal(7, 33.333)).toBe(233.33);
  });

  it('is 0 rather than NaN for an unfinished form', () => {
    expect(previewTotal('', 100)).toBe(0);
    expect(previewTotal(0, 100)).toBe(0);
    expect(previewTotal(-2, 100)).toBe(0);
    expect(previewTotal(2, undefined)).toBe(0);
  });
});

describe('describeLowStock', () => {
  it('explains the alert with both numbers', () => {
    expect(describeLowStock({ threshold: 120, current_qty: 0, raised: true }))
      .toBe('Below the critical level: 0 left, reorder at 120.');
  });

  it('is null when no alert was raised', () => {
    expect(describeLowStock(null)).toBeNull();
    expect(describeLowStock({})).toBeNull();
    expect(describeLowStock({ threshold: 'x', current_qty: 0 })).toBeNull();
  });
});