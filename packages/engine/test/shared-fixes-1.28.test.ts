/**
 * From the reviews of Shap 1.28.0, in the code Shap Pocket shares with it: amounts a package writes
 * with the currency before brackets, or with Dr and Cr after them, read with their signs (the
 * accounting review's finding 11). All data made up.
 */
import { describe, expect, it } from 'vitest';
import { parseMoney } from '../src/modules/movein.js';

describe('the shared fixes from Shap 1.28.0', () => {
  it('reads a currency before brackets, and Dr and Cr, with their signs', () => {
    expect(parseMoney('R (1 234.56)')).toBe(-123_456);
    expect(parseMoney('1 234.56 Cr')).toBe(-123_456);
    expect(parseMoney('1 234.56Cr')).toBe(-123_456);
    expect(parseMoney('1 234.56 Dr')).toBe(123_456);
    expect(parseMoney('Cr 500.00')).toBe(-50_000);
    // As before.
    expect(parseMoney('(1 234.56)')).toBe(-123_456);
    expect(parseMoney('R -1 234.50')).toBe(-123_450);
    expect(parseMoney('R 1 234.50')).toBe(123_450);
    expect(parseMoney('1,234.56-')).toBe(-123_456);
  });
});
