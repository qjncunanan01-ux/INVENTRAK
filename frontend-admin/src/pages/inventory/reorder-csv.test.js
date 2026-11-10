import { describe, expect, test } from 'vitest';
import { buildReorderCsv } from './reorder-csv';

describe('buildReorderCsv', () => {
  test('prefixes formula-like product names before exporting', () => {
    const csv = buildReorderCsv([
      {
        product_name: '=SUM(1,1)',
        on_hand: 2,
        critical_level: 1,
        reorder_point: 4,
        safety_stock: 2,
        recommended_quantity: 5,
        recommendation_basis: 'eoq',
      },
    ]);

    expect(csv).toContain('"\'=SUM(1,1)"');
  });

  test('skips whitespace and ASCII control characters before checking the formula prefix', () => {
    const csv = buildReorderCsv([
      {
        product_name: '\u0000\t@SUM(1,1)',
        on_hand: 2,
        critical_level: 1,
        reorder_point: 4,
        safety_stock: 2,
        recommended_quantity: 5,
        recommendation_basis: 'eoq',
      },
    ]);

    expect(csv).toContain('"\'\u0000\t@SUM(1,1)"');
  });
});
