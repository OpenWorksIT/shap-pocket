import { describe, expect, it } from 'vitest';
import { shareProblem, type PocketShare } from '@shap/shared';

// Round 8 (security), in the code Shap reads shares with: a journal id held in a JSON array
// (["…"], [["…"]]) reaches Shap's database as the id itself (the driver sends '' + x), so its
// lines are one journal and must be counted as one. Made-up id.
describe('a share’s journal, its id held in an array', () => {
  it('is counted as one journal', () => {
    const id = '4a6c8e0b-2d4f-4a6b-8c0d-1e2f3a4b5c6d';
    const lines = Array.from({ length: 1200 }, (_, i) => ({ journal_id: i % 2 ? [id] : [[id.toUpperCase()]], debit_cents: 1, credit_cents: 0 }));
    const share = { records: { settings: [{}], journal_lines: lines }, entries: [] } as unknown as PocketShare;
    expect(shareProblem(share)).toEqual({ kind: 'long_journal', table: 'journal_lines' });
  });
});
