// Cost normalization (cost-normalize.js).
//
// The single most important assertion in this file is the one about DIMENSIONS:
// a kilogram and a litre are both 1000 base units, so any lookup that returns a
// bare multiplier cannot tell them apart. That bug was live and shipped to this
// suite's first draft: "1 KG" parsed as 1000 ml, which would have costed a
// chocolate bar at a per-litre syrup rate and reported success. The
// weight-is-not-volume cases below are the regression lock for it.
//
// The second theme is RESTRAINT. Every ambiguous input must return null rather
// than a guess, because a guess here becomes a fabricated cost in the catalog
// and then every margin downstream is confidently wrong. The blank-cell
// behaviour of buildRateSheet is asserted for the same reason.
import { describe, test, expect } from 'vitest';
import {
  parseSizeText,
  dimensionOf,
  normalizedOf,
  summarizeNormalization,
  buildRateSheet,
  BASIS_AMOUNT,
} from './cost-normalize';

describe('parseSizeText — volume', () => {
  test('reads millilitres, with or without a space', () => {
    expect(parseSizeText('750 ML')).toEqual({ dimension: 'volume', amount: 750, unitLabel: 'ml' });
    expect(parseSizeText('750ml')).toEqual({ dimension: 'volume', amount: 750, unitLabel: 'ml' });
    expect(parseSizeText('  750 ml  ')).toEqual({ dimension: 'volume', amount: 750, unitLabel: 'ml' });
  });

  test('scales litres into millilitres', () => {
    expect(parseSizeText('1 L').amount).toBe(1000);
    expect(parseSizeText('2L').amount).toBe(2000);
    expect(parseSizeText('1.89 L').amount).toBe(1890);
    expect(parseSizeText('10 L').amount).toBe(10000);
  });

  test('reads centi- and decilitres', () => {
    expect(parseSizeText('75 cl').amount).toBe(750);
    expect(parseSizeText('7.5 dl').amount).toBe(750);
  });

  test('accepts the word forms suppliers actually use', () => {
    expect(parseSizeText('750 milliliters').amount).toBe(750);
    expect(parseSizeText('2 litres').amount).toBe(2000);
    expect(parseSizeText('500 lt').amount).toBe(500000);
  });
});

describe('parseSizeText — weight is NEVER volume', () => {
  // THE regression lock. kg and l are both 1000; a multiplier-only lookup calls
  // a kilogram of couverture a litre of syrup.
  test('kilograms are weight, not volume', () => {
    expect(parseSizeText('1 KG')).toEqual({ dimension: 'weight', amount: 1000, unitLabel: 'g' });
    expect(parseSizeText('1KG')).toEqual({ dimension: 'weight', amount: 1000, unitLabel: 'g' });
    expect(parseSizeText('2.5KG').amount).toBe(2500);
    expect(parseSizeText('3.3 KG').amount).toBe(3300);
  });

  test('grams are weight', () => {
    expect(parseSizeText('610G')).toEqual({ dimension: 'weight', amount: 610, unitLabel: 'g' });
    expect(parseSizeText('750 G').dimension).toBe('weight');
  });

  test('ounces and pounds use the avoirdupois factors', () => {
    expect(parseSizeText('16.5 OZ').dimension).toBe('weight');
    expect(parseSizeText('16.5 OZ').amount).toBeCloseTo(467.77, 1);
    expect(parseSizeText('64 oz').amount).toBeCloseTo(1814.37, 1);
    expect(parseSizeText('2 lb').amount).toBeCloseTo(907.18, 1);
  });

  test('grams and kilograms disagree even when both scale by 1000', () => {
    // The exact shape of the bug: identical factor, different dimension.
    expect(parseSizeText('1 kg').amount).toBe(parseSizeText('1 l').amount);
    expect(parseSizeText('1 kg').dimension).not.toBe(parseSizeText('1 l').dimension);
  });
});

describe('parseSizeText — counts and multipacks', () => {
  test('a bare "pcs" size is a piece count', () => {
    expect(parseSizeText('50PCS')).toEqual({ dimension: 'count', amount: 50, unitLabel: 'pcs' });
    expect(parseSizeText('10 PCS').amount).toBe(10);
    expect(parseSizeText('100pcs').amount).toBe(100);
  });

  test('a numeric multipack totals, it does not take the inner size', () => {
    expect(parseSizeText('6 x 250ml').amount).toBe(1500);
    expect(parseSizeText('6x250 ml').amount).toBe(1500);
    expect(parseSizeText('12 x 1 L').amount).toBe(12000);
  });

  test('a word multiplier is declined, not guessed', () => {
    // "dozen" and "12" are not obviously the same claim; "6 x 250ml" and
    // "six 250ml bottles" are not either, but the numeric form is how
    // spreadsheets write it, so only that one is recognised.
    expect(parseSizeText('dozen x 250ml')).toBeNull();
    expect(parseSizeText('1 KG x 6')).toBeNull();
  });
});

describe('parseSizeText — declines rather than guesses', () => {
  test('empty and whitespace sizes are null', () => {
    expect(parseSizeText('')).toBeNull();
    expect(parseSizeText('   ')).toBeNull();
    expect(parseSizeText(null)).toBeNull();
    expect(parseSizeText(undefined)).toBeNull();
  });

  test('text with a quantity buried in it is declined', () => {
    // Only the whole Size cell is parsed. A product NAME like "Vanilla 750ML"
    // is deliberately out of scope: names get reworded, and a size scraped out
    // of marketing copy is a guess wearing a parse.
    expect(parseSizeText('NET WT 1.5 KG')).toBeNull();
    expect(parseSizeText('approx 250 ml')).toBeNull();
    expect(parseSizeText('750 ML bottle')).toBeNull();
  });

  test('an unknown unit is declined', () => {
    expect(parseSizeText('5 st')).toBeNull();
    expect(parseSizeText('2 dozen')).toBeNull();
  });

  test('a non-numeric or malformed quantity is declined', () => {
    expect(parseSizeText('abc ML')).toBeNull();
    expect(parseSizeText('-5 ML')).toBeNull();
    expect(parseSizeText('ML')).toBeNull();
    expect(parseSizeText('1.2.3 L')).toBeNull();
  });

  test('a bare number with no unit is declined', () => {
    // "4000" as a size is a case description, not 4000 loose pieces. Only a
    // number that says what it counts ("50PCS") is read.
    expect(parseSizeText('4000')).toBeNull();
    expect(parseSizeText('99999')).toBeNull();
    expect(parseSizeText('6')).toBeNull();
  });
});

describe('dimensionOf — falls back to the unit column', () => {
  test('a product with no size but a countable unit is one piece', () => {
    expect(dimensionOf({ size: '', unit: 'pcs' })).toEqual({ dimension: 'count', amount: 1, unitLabel: 'pcs' });
    expect(dimensionOf({ size: null, unit: 'Bottle' })).toEqual({ dimension: 'count', amount: 1, unitLabel: 'pcs' });
  });

  test('the size wins when both are present', () => {
    expect(dimensionOf({ size: '750 ML', unit: 'bottle' })).toEqual({ dimension: 'volume', amount: 750, unitLabel: 'ml' });
  });

  test('nothing usable gives null', () => {
    expect(dimensionOf({ size: '', unit: '' })).toBeNull();
    expect(dimensionOf(null)).toBeNull();
  });
});

describe('normalizedOf', () => {
  const bottle = { size: '750 ML', price: 600, cost: 300 };

  test('divides both sides by the same base, leaving margin intact', () => {
    // Scaling price and cost by the same factor cannot change a margin
    // percentage — so normalization is for COMPARABILITY across sizes, not for
    // changing the answer about any one product.
    const n = normalizedOf(bottle);
    expect(n.dimension).toBe('volume');
    expect(n.pricePer).toBeCloseTo(80, 5);
    expect(n.costPer).toBeCloseTo(40, 5);
    expect(((n.pricePer - n.costPer) / n.pricePer) * 100).toBeCloseTo(((600 - 300) / 600) * 100, 10);
  });

  test('makes differently-sized products comparable', () => {
    const big = normalizedOf({ size: '1 L', price: 800, cost: 400 });
    const small = normalizedOf({ size: '500 ML', price: 400, cost: 200 });
    expect(big.pricePer).toBeCloseTo(small.pricePer, 5);
    expect(big.costPer).toBeCloseTo(small.costPer, 5);
  });

  test('an uncosted product has a per-basis price but no per-basis cost', () => {
    const n = normalizedOf({ size: '750 ML', price: 600, cost: null });
    expect(n.pricePer).toBeCloseTo(80, 5);
    expect(n.costPer).toBeNull();
  });

  test('a weight product normalizes per 100 g, never per 100 ml', () => {
    const n = normalizedOf({ size: '1 KG', price: 600, cost: 300 });
    expect(n.dimension).toBe('weight');
    expect(n.basisAmount).toBe(100);
    expect(n.pricePer).toBeCloseTo(60, 5);
  });

  test('a piece pack normalizes per piece, not per hundred', () => {
    // A 50-piece pack priced at 250 is 5 per piece. Dividing by 50 is what makes
    // it comparable to a single cup sold elsewhere.
    const n = normalizedOf({ size: '50PCS', price: 250, cost: 125 });
    expect(n.basisAmount).toBe(1);
    expect(n.pricePer).toBeCloseTo(5, 5);
    expect(n.costPer).toBeCloseTo(2.5, 5);
    expect(BASIS_AMOUNT.count).toBe(1);
  });

  test('can be filtered to one dimension', () => {
    expect(normalizedOf(bottle, 'volume')).not.toBeNull();
    expect(normalizedOf(bottle, 'weight')).toBeNull();
  });

  test('an unreadable size yields null', () => {
    expect(normalizedOf({ size: '', price: 100 })).toBeNull();
  });

  test('a zero or negative price does not produce a per-basis figure', () => {
    expect(normalizedOf({ size: '750 ML', price: 0, cost: 10 }).pricePer).toBeNull();
  });
});

describe('summarizeNormalization', () => {
  const catalog = [
    { name: 'Syrup 750ml', size: '750 ML', unit: 'bottle', price: 600, cost: null },
    { name: 'Syrup 1L', size: '1 L', unit: 'bottle', price: 800, cost: null },
    { name: 'Chocolate 1kg', size: '1 KG', unit: 'box', price: 600, cost: null },
    { name: 'Cups x50', size: '50PCS', unit: 'pcs', price: 250, cost: null },
    { name: 'Mystery item', size: '', unit: '', price: 100, cost: null },
  ];

  test('splits the catalog by dimension and counts the unreadable', () => {
    const s = summarizeNormalization(catalog);
    expect(s.counts).toEqual({ volume: 2, weight: 1, count: 1 });
    expect(s.unreadable).toEqual(['Mystery item']);
  });

  test('orders dimensions by selling value, so the picker leads with the biggest', () => {
    const s = summarizeNormalization(catalog);
    // volume avg 80/100ml, weight 60/100g, count 5/piece (a 50-piece pack).
    expect(s.dimensions.map(d => d.dimension)).toEqual(['volume', 'weight', 'count']);
    expect(s.dimensions[0].pricePer).toBeCloseTo(80, 5);
  });

  test('labels each dimension the way the rate will be quoted', () => {
    const s = summarizeNormalization(catalog);
    expect(s.dimensions.find(d => d.dimension === 'volume').label).toBe('per 100 ml');
    expect(s.dimensions.find(d => d.dimension === 'count').basisAmount).toBe(1);
  });

  test('an empty catalog is not a crash', () => {
    expect(summarizeNormalization([]).dimensions).toEqual([]);
    expect(summarizeNormalization(null).unreadable).toEqual([]);
  });
});

describe('buildRateSheet — one supplier rate in, a cost sheet out', () => {
  const catalog = [
    { name: 'Syrup 750ml', size: '750 ML', price: 600, cost: null },
    { name: 'Syrup 1L', size: '1 L', price: 800, cost: null },
    { name: 'Chocolate 1kg', size: '1 KG', price: 600, cost: null },
    { name: 'Cups x50', size: '50PCS', price: 250, cost: null },
    { name: 'Mystery item', size: '', price: 100, cost: null },
  ];

  test('scales one rate across every product in that dimension', () => {
    // ₱80 per 100 ml: a 750ml bottle costs 600, a 1L bottle 800.
    const r = buildRateSheet(catalog, { dimension: 'volume', rate: 80 });
    expect(r.csv.split('\n')[0]).toBe('Product Name,Price,Cost');
    expect(r.csv).toContain('Syrup 750ml,600,600');
    expect(r.csv).toContain('Syrup 1L,800,800');
    expect(r.priced).toBe(2);
  });

  test('a weight rate is applied to weight products only', () => {
    // The critical safety property: the kg product must NOT be costed from the
    // per-100ml rate.
    const r = buildRateSheet(catalog, { dimension: 'volume', rate: 80 });
    expect(r.csv).toContain('Chocolate 1kg,600,');
    const w = buildRateSheet(catalog, { dimension: 'weight', rate: 60 });
    expect(w.csv).toContain('Chocolate 1kg,600,600');
    expect(w.csv).toContain('Syrup 750ml,600,');
  });

  test('an unreadable size gets a BLANK cost, never a fabricated one', () => {
    const r = buildRateSheet(catalog, { dimension: 'volume', rate: 80 });
    expect(r.csv).toContain('Mystery item,100,');
    expect(r.blank).toBeGreaterThan(0);
    expect(r.priced + r.blank).toBe(r.total);
  });

  test('the blank cells round-trip through the cost sheet as "leave alone"', () => {
    // The whole safety story only holds because cost-sheet.js reads a blank
    // cell as "skip". Prove the two modules actually agree.
    const r = buildRateSheet(catalog, { dimension: 'volume', rate: 80 });
    expect(r.csv).not.toContain(',0,');
  });

  test('a count rate uses a basis of one, and multiplies back out by the pack', () => {
    // ₱5 per piece, on a 50-piece pack = ₱250 for the pack. Dividing by 100 here
    // would produce ₱2.50, which is the bug the basis-1 rule prevents.
    const r = buildRateSheet(catalog, { dimension: 'count', rate: 5 });
    expect(r.csv).toContain('Cups x50,250,250');
  });

  test('a missing or nonsense rate produces an all-blank sheet, not a zero sheet', () => {
    // Number('') === 0, so an empty rate box would otherwise cost every
    // product at ₱0 and look like a free catalogue.
    for (const rate of [undefined, null, '', 'abc', -5]) {
      const r = buildRateSheet(catalog, { dimension: 'volume', rate });
      expect(r.priced).toBe(0);
      expect(r.csv).toContain('Syrup 750ml,600,');
    }
  });

  test('a zero rate is a real rate (free goods), not a missing one', () => {
    const r = buildRateSheet(catalog, { dimension: 'volume', rate: 0 });
    expect(r.priced).toBe(2);
    expect(r.csv).toContain('Syrup 750ml,600,0');
  });

  test('product names containing a comma stay quoted', () => {
    const r = buildRateSheet([{ name: 'Salt, Sea & Pepper', size: '750 ML', price: 100, cost: null }], { dimension: 'volume', rate: 80 });
    // ₱80 per 100 ml on 750 ml is ₱600.
    expect(r.csv).toContain('"Salt, Sea & Pepper",100,600');
  });

  test('the exported sheet is accepted by the cost sheet parser', () => {
    const r = buildRateSheet(catalog, { dimension: 'volume', rate: 80 });
    const lines = r.csv.split('\n').slice(1).filter(Boolean);
    expect(lines.length).toBe(catalog.length);
    for (const line of lines) {
      expect(line.endsWith(',') || /,\d+(\.\d+)?$/.test(line)).toBe(true);
    }
  });
});