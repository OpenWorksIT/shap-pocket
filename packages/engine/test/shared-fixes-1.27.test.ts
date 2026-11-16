/**
 * From the reviews of Shap 1.27.0, in the code Shap Pocket shares with it: Xero's trial balance read
 * from its year-to-date columns (not the month's), and a public holiday declared for one year.
 * All data made up.
 */
import { describe, expect, it } from 'vitest';
import { businessDayOnOrBefore, isBusinessDay } from '@shap/shared';
import { readExportFile } from '../src/modules/movein.js';

describe('the shared fixes from Shap 1.27.0', () => {
  it('reads a Xero trial balance from its year-to-date columns, not the month’s', () => {
    const xero = `Trial Balance
Fictional Electrical (Pty) Ltd
As at 31 October 2026
Account,Account Code,Account Type,Debit,Credit,YTD Debit,YTD Credit
Business Bank Account,090,Bank,"1,200.00",,"18,400.00",
Sales,200,Revenue,,"3,000.00",,"41,000.00"
Wages,477,Expense,"1,800.00",,"22,600.00",
Total,,,"3,000.00","3,000.00","41,000.00","41,000.00"
`;
    const x = readExportFile('Trial_Balance.csv', xero);
    expect(x.kind).toBe('trialBalance');
    expect(x.tb!.map((l) => [l.code, l.cents])).toEqual([
      ['090', 1840000],
      ['200', -4100000],
      ['477', 2260000],
    ]);
  });

  it('knows 4 November 2026 (the local government elections) was a public holiday', () => {
    expect(isBusinessDay('2026-11-04')).toBe(false);
    expect(businessDayOnOrBefore('2026-11-04')).toBe('2026-11-03');
  });
});
