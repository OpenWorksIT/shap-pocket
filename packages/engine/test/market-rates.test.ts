/** Market-rate ranges (market-rates branch): the middle half of what businesses charged. */
import { describe, expect, it } from 'vitest';
import { marketBand, rangeForLine, rangeFromBands } from '@shap/shared';

describe('ranges from the tallies', () => {
  it('takes the quarter, middle and three-quarter prices, and matches a line', () => {
    const bands: Record<string, number> = {};
    for (const c of [40000, 45000, 50000, 55000, 60000, 65000, 70000, 75000]) bands[marketBand(c)] = (bands[marketBand(c)] ?? 0) + 1;
    const r = rangeFromBands(bands)!;
    expect(r.low).toBeGreaterThan(42000);
    expect(r.low).toBeLessThan(48000);
    expect(r.high).toBeGreaterThan(62000);
    expect(r.high).toBeLessThan(68000);
    expect(rangeFromBands({})).toBeNull();
    expect(rangeForLine([{ item: 'Install plug point', unit: 'point', lowCents: 1, midCents: 2, highCents: 3, businesses: 5 }], ' install plug POINT', 'Point')?.businesses).toBe(5);
  });
});
