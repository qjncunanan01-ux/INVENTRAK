// Unit tests for the cost-of-goods sheet parser.
//
// The behaviour locked down here is the one the module was written for: a BLANK
// cost cell means "leave this product's cost alone", never "clear it". Getting
// that backwards would let an admin who fills in four rows of a downloaded
// sheet silently wipe every other cost in the catalog while the API reports
// success — so it is asserted from every direction, including end to end
// through the payload the server actually receives.
import { parseCostSheet, toCostPayload, summarizeCostSheet, buildCostTemplate, marginPercentOf, marginBucket, coverageOf, sheetDiff, buildCostInsights } from './cost-sheet';

describe('parseCostSheet', () => {
  test('parses name,cost with an optional header', () => {
    expect(parseCostSheet('Product Name,Cost\nAlmond Roca,380\nCaramel Syrup,499')).toEqual([
      { id: undefined, name: 'Almond Roca', cost: 380 },
      { id: undefined, name: 'Caramel Syrup', cost: 499 },
    ]);
    // The header is optional, but only the first line may be one.
    expect(parseCostSheet('Almond Roca,380')).toEqual([{ id: undefined, name: 'Almond Roca', cost: 380 }]);
  });

  test('a blank cost cell means LEAVE ALONE, not clear', () => {
    // The load-bearing assertion of this whole module.
    expect(parseCostSheet('Almond Roca,380\nBlueberry,')).toEqual([
      { id: undefined, name: 'Almond Roca', cost: 380 },
      { id: undefined, name: 'Blueberry', cost: undefined },
    ]);
  });

  test('an explicit token clears the cost', () => {
    for (const token of ['-', 'clear', 'none', 'N/A']) {
      const rows = parseCostSheet(`Almond Roca,${token}`);
      expect(rows[0].cost).toBeNull();
    }
  });

  test('zero is a real cost, not a blank', () => {
    expect(parseCostSheet('Almond Roca,0')[0].cost).toBe(0);
  });

  test('currency symbols and thousands separators are stripped', () => {
    // The quoted form is what a spreadsheet writes, and it is unambiguous.
    expect(parseCostSheet('Almond Roca,"1,250"')[0].cost).toBe(1250);
    expect(parseCostSheet('Almond Roca,"₱1,250.50"')[0].cost).toBe(1250.5);
    // An unquoted one is re-joined on the currency fragment, because "₱1,250"
    // would otherwise split into two fields and cost only the 250.
    expect(parseCostSheet('Almond Roca,₱1,250.50')[0].cost).toBe(1250.5);
    // A bare thousands group in the middle stays a real middle column.
    expect(parseCostSheet('Almond Roca,520,380')[0].cost).toBe(380);
  });

  test('a quoted name may contain commas', () => {
    // Standard CSV: a field containing the delimiter must be quoted, which is
    // exactly what buildCostTemplate emits — so the round trip is lossless.
    expect(parseCostSheet('"Salt, Sea & Pepper",300')).toEqual([
      { id: undefined, name: 'Salt, Sea & Pepper', cost: 300 },
    ]);
  });

  test('an unquoted 3-column row is read as name,price,cost', () => {
    // The documented rule for the ambiguous case. Quoting is the answer for a
    // name that genuinely contains a comma; silently joining the columns would
    // make "Name,520,380" and "Name,1,250.50" indistinguishable.
    expect(parseCostSheet('Almond Roca,520,380')).toEqual([
      { id: undefined, name: 'Almond Roca', cost: 380 },
    ]);
  });

  test('a middle Price column is ignored', () => {
    // The downloaded template is Name,Price,Cost — re-uploading it unchanged
    // must not treat the price as the cost.
    const rows = parseCostSheet('Product Name,Price,Cost\nAlmond Roca,520,380');
    expect(rows).toEqual([{ id: undefined, name: 'Almond Roca', cost: 380 }]);
  });

  test('a leading numeric id column is captured', () => {
    const rows = parseCostSheet('42,Almond Roca,380');
    expect(rows[0].id).toBe(42);
    expect(rows[0].name).toBe('Almond Roca');
    expect(rows[0].cost).toBe(380);
  });

  test('tab-separated rows from Excel parse identically', () => {
    expect(parseCostSheet('Almond Roca\t380\nBlueberry\t')).toEqual([
      { id: undefined, name: 'Almond Roca', cost: 380 },
      { id: undefined, name: 'Blueberry', cost: undefined },
    ]);
  });

  test('quoted names are unquoted', () => {
    expect(parseCostSheet('"Almond Roca",380')[0].name).toBe('Almond Roca');
  });

  test('a negative or unreadable cost is junk, not a clear and not a set', () => {
    expect(Number.isNaN(parseCostSheet('Almond Roca,-5')[0].cost)).toBe(true);
    expect(Number.isNaN(parseCostSheet('Almond Roca,abc')[0].cost)).toBe(true);
  });

  test('empty and whitespace-only input yield no rows', () => {
    expect(parseCostSheet('')).toEqual([]);
    expect(parseCostSheet('   \n  \n')).toEqual([]);
    expect(parseCostSheet(null)).toEqual([]);
  });

  test('a name that looks like a header mid-file is data, not a header', () => {
    const rows = parseCostSheet('Almond Roca,380\nCost,500');
    expect(rows).toHaveLength(2);
    expect(rows[1].name).toBe('Cost');
  });
});

describe('toCostPayload', () => {
  test('drops untouched rows entirely so the server sees an absent key', () => {
    // Dropping is the mechanism: sending `cost: null` for a skipped row would
    // clear it, which is the exact data loss this module prevents.
    const payload = toCostPayload([
      { name: 'Set it', cost: 380 },
      { name: 'Leave it', cost: undefined },
      { name: 'Clear it', cost: null },
      { name: 'Junk', cost: NaN },
    ]);
    expect(payload).toEqual([
      { name: 'Set it', cost: 380 },
      { name: 'Clear it', cost: null },
    ]);
    expect(payload.some(r => 'cost' in r && r.cost === null && r.name === 'Leave it')).toBe(false);
  });

  test('includes the id when the row had one', () => {
    expect(toCostPayload([{ id: 7, name: 'X', cost: 1 }])).toEqual([{ id: 7, name: 'X', cost: 1 }]);
  });
});

describe('summarizeCostSheet', () => {
  const catalog = [
    { id: 1, name: 'Almond Roca', price: 520 },
    { id: 2, name: 'Blueberry', price: 495 },
    { id: 3, name: 'Caramel Syrup', price: 499 },
  ];

  test('counts what will be set, cleared and skipped', () => {
    const s = summarizeCostSheet(
      [
        { id: 1, name: 'Almond Roca', cost: 380 },
        { id: 2, name: 'Blueberry', cost: undefined },
        { id: 3, name: 'Caramel Syrup', cost: null },
      ],
      catalog,
    );
    expect(s.total).toBe(3);
    expect(s.willSet).toBe(1);
    expect(s.willSkip).toBe(1);
    expect(s.willClear).toBe(1);
    expect(s.unmatched).toEqual([]);
  });

  test('matches names case-insensitively when no id is given', () => {
    const s = summarizeCostSheet([{ name: 'almond roca', cost: 380 }], catalog);
    expect(s.unmatched).toEqual([]);
    expect(s.willSet).toBe(1);
  });

  test('flags names that are not in the catalog', () => {
    const s = summarizeCostSheet([{ name: 'Ghost Product', cost: 10 }], catalog);
    expect(s.matched).toBe(0);
    expect(s.unmatched).toEqual([{ name: 'Ghost Product', reason: 'not in catalog' }]);
  });

  test('flags a cost at or above the selling price as a likely data-entry slip', () => {
    // Transposed price/cost columns are the classic mistake, and costing.js
    // would faithfully report a 0% or negative margin from it — which reads
    // like a bug in the math rather than a typo in the sheet.
    const s = summarizeCostSheet([{ id: 1, name: 'Almond Roca', cost: 520 }], catalog);
    expect(s.lossMakers).toEqual([{ name: 'Almond Roca', cost: 520, price: 520 }]);
  });

  test('a healthy margin is not flagged', () => {
    expect(summarizeCostSheet([{ id: 1, name: 'Almond Roca', cost: 300 }], catalog).lossMakers).toEqual([]);
  });

  test('unreadable cost cells are reported separately, not guessed at', () => {
    const s = summarizeCostSheet([{ id: 1, name: 'Almond Roca', cost: NaN }], catalog);
    expect(s.junk).toBe(1);
    expect(s.willSet).toBe(0);
    expect(s.unmatched[0].reason).toBe('unreadable cost');
  });
});

describe('buildCostTemplate', () => {
  test('emits name,price,cost so the margin is visible while typing', () => {
    const csv = buildCostTemplate([
      { name: 'Almond Roca', price: 520, cost: 380 },
      { name: 'Blueberry', price: 495, cost: null },
    ]);
    expect(csv.split('\n')).toEqual([
      'Product Name,Price,Cost',
      'Almond Roca,520,380',
      // An uncosted product exports blank, which round-trips as "leave alone".
      'Blueberry,495,',
    ]);
  });

  test('quotes names containing a comma so the sheet re-imports cleanly', () => {
    const csv = buildCostTemplate([{ name: 'Salt, Sea & Pepper', price: 300, cost: 100 }]);
    const roundTrip = parseCostSheet(csv);
    expect(roundTrip).toEqual([{ id: undefined, name: 'Salt, Sea & Pepper', cost: 100 }]);
  });

  test('the exported template round-trips without clearing anything', () => {
    // The real workflow: download, fill some rows, re-upload. Unfilled rows
    // must come back as "leave alone", never as "clear".
    const catalog = [
      { name: 'Costed A', price: 100, cost: 40 },
      { name: 'Costed B', price: 200, cost: 80 },
    ];
    const roundTrip = parseCostSheet(buildCostTemplate(catalog));
    expect(toCostPayload(roundTrip)).toEqual([
      { name: 'Costed A', cost: 40 },
      { name: 'Costed B', cost: 80 },
    ]);
  });
});

describe('marginPercentOf', () => {
  test('is the gross margin over the selling price', () => {
    expect(marginPercentOf({ price: 100, cost: 70 })).toBe(30);
    expect(marginPercentOf({ price: 500, cost: 400 })).toBe(20);
  });

  test('is null for an uncosted product, NOT zero', () => {
    // The distinction the whole read side rests on: no cost is UNKNOWN, not
    // "no margin". Collapsing them would report an uncosted catalog as a
    // business losing money on every line.
    expect(marginPercentOf({ price: 100, cost: null })).toBeNull();
    expect(marginPercentOf({ price: 100, cost: undefined })).toBeNull();
    expect(marginPercentOf({ price: 100, cost: '' })).toBeNull();
  });

  test('a real zero cost is a 100% margin, not unknown', () => {
    expect(marginPercentOf({ price: 100, cost: 0 })).toBe(100);
  });

  test('is null rather than a division by zero when the price is unusable', () => {
    expect(marginPercentOf({ price: 0, cost: 10 })).toBeNull();
    expect(marginPercentOf({ price: -5, cost: 10 })).toBeNull();
    expect(marginPercentOf({ price: null, cost: 10 })).toBeNull();
  });

  test('goes negative when the cost exceeds the price', () => {
    expect(marginPercentOf({ price: 100, cost: 120 })).toBe(-20);
  });
});

describe('marginBucket', () => {
  test('classifies at the boundaries, which are the ones that get argued about', () => {
    expect(marginBucket({ price: 100, cost: 120 })).toBe('loss');
    expect(marginBucket({ price: 100, cost: 100 })).toBe('thin'); // 0%
    expect(marginBucket({ price: 100, cost: 81 })).toBe('thin'); // 19% -> thin
    expect(marginBucket({ price: 100, cost: 80 })).toBe('healthy'); // exactly 20% is healthy
    expect(marginBucket({ price: 100, cost: 50 })).toBe('rich'); // exactly 50% is rich
    expect(marginBucket({ price: 100, cost: 49 })).toBe('rich'); // 51%
  });

  test('uncosted outranks every margin state', () => {
    expect(marginBucket({ price: 100, cost: null })).toBe('uncosted');
  });
});

describe('coverageOf', () => {
  test('reports how much of the catalog is left to cost', () => {
    const c = coverageOf([
      { price: 100, cost: 70 },
      { price: 100, cost: null },
      { price: 100, cost: 0 },
      { price: 100, cost: null },
    ]);
    expect(c).toEqual({ costed: 2, total: 4, uncosted: 2, pct: 50 });
  });

  test('a zero cost counts as costed', () => {
    // "Costed" means a known unit cost, and 0 is a known unit cost.
    expect(coverageOf([{ price: 100, cost: 0 }]).costed).toBe(1);
  });

  test('an empty catalog is 0% and does not divide by zero', () => {
    expect(coverageOf([])).toEqual({ costed: 0, total: 0, uncosted: 0, pct: 0 });
    expect(coverageOf(null).pct).toBe(0);
  });
});

describe('sheetDiff', () => {
  const catalog = [
    { id: 1, name: 'Almond Roca', price: 520, cost: null },
    { id: 2, name: 'Blueberry', price: 495, cost: 300 },
  ];

  test('shows the before and after, which the browser UI used to omit', () => {
    const rows = parseCostSheet('Almond Roca,380');
    expect(sheetDiff(rows, catalog)).toEqual([
      { id: 1, name: 'Almond Roca', from: null, to: 380, status: 'set' },
    ]);
  });

  test('distinguishes set, cleared, untouched and unchanged', () => {
    const rows = parseCostSheet('Almond Roca,380\nBlueberry,-\nAlmond Roca,\nBlueberry,300');
    expect(sheetDiff(rows, catalog).map(d => d.status)).toEqual(['set', 'cleared', 'untouched', 'unchanged']);
  });

  test('a clear reports the previous cost, so the loss is visible', () => {
    const rows = parseCostSheet('Blueberry,-');
    expect(sheetDiff(rows, catalog)[0]).toMatchObject({ from: 300, to: null, status: 'cleared' });
  });

  test('drops rows with no catalog match', () => {
    expect(sheetDiff(parseCostSheet('Ghost Product,10'), catalog)).toEqual([]);
  });

  test('matches by id when the sheet carries one', () => {
    expect(sheetDiff([{ id: 2, name: 'wrong name entirely', cost: 10 }], catalog)[0].id).toBe(2);
  });
});

describe('buildCostInsights', () => {
  const catalog = [
    { id: 1, name: 'Cheap Cup', category: 'Cups', price: 100, cost: 80 }, // 20% margin
    { id: 2, name: 'Fancy Cup', category: 'Cups', price: 200, cost: 50 }, // 75% margin
    { id: 3, name: 'Sack', category: 'Dry goods', price: 1000, cost: 900 }, // 10%
    { id: 4, name: 'Uncosted', category: 'Dry goods', price: 500, cost: null },
  ];

  test('blended margin is value-weighted, not an average of percentages', () => {
    // Averaging (20 + 75 + 10) / 3 = 35% would let the ₱100 cup count as much
    // as the ₱1,000 sack. Summing first: (1300 - 1030) / 1300 = 20.8%.
    const i = buildCostInsights(catalog, 30);
    expect(i.blendedMargin).toBeCloseTo(20.77, 1);
  });

  test('the uncosted product is excluded from the margin maths entirely', () => {
    const i = buildCostInsights(catalog, 30);
    expect(i.coverage.costed).toBe(3);
    expect(i.coverage.uncosted).toBe(1);
  });

  test('groups by category and ranks by how many products each holds', () => {
    const i = buildCostInsights(catalog, 30);
    // Cups holds 2 costed products, Dry goods only 1 — its second product is
    // uncosted and therefore not in the margin maths at all.
    expect(i.categories.map(c => c.category)).toEqual(['Cups', 'Dry goods']);
    const cups = i.categories.find(c => c.category === 'Cups');
    expect(cups.costed).toBe(2);
    expect(cups.margin).toBeCloseTo(56.67, 1); // (300 - 130) / 300
  });

  test('flags products under the target margin with a suggested price', () => {
    const i = buildCostInsights(catalog, 30);
    // 30% margin on a 900 cost needs 900 / 0.7 = 1285.71.
    expect(i.underPriced[0]).toMatchObject({ name: 'Sack', margin: 10, suggested: 1286 });
    expect(i.underPriced.map(u => u.name)).toEqual(['Sack', 'Cheap Cup']);
  });

  test('excludes uncosted products from the under-priced list', () => {
    // An uncosted product has no margin to judge against flagging it would
    // accuse the admin of under-pricing a product they have not costed.
    expect(buildCostInsights(catalog, 30).underPriced.map(u => u.name)).not.toContain('Uncosted');
  });

  test('counts loss-makers separately', () => {
    const i = buildCostInsights([{ id: 9, name: 'Bad', price: 100, cost: 130 }], 30);
    expect(i.lossMakers).toBe(1);
  });

  test('falls back to a 30% target when given nonsense', () => {
    expect(buildCostInsights(catalog, 0).target).toBe(30);
    expect(buildCostInsights(catalog, 'abc').target).toBe(30);
  });

  test('an entirely uncosted catalog reports no blended margin, not 0%', () => {
    const i = buildCostInsights([{ id: 1, name: 'X', price: 100, cost: null }], 30);
    expect(i.blendedMargin).toBeNull();
    expect(i.underPriced).toEqual([]);
  });
});
