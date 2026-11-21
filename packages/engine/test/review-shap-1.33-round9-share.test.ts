import { describe, expect, it } from 'vitest';
import { shareProblem, type PocketShare } from '@shap/shared';

// From Shap's ninth review round of 1.33 (security), in the code Pocket shares with it: a share's
// values that can't be written as text are too big, not an error, and an array is measured as the
// driver writes it. Made-up ids and values.

const share = (lines: Record<string, unknown>[]) => ({ records: { settings: [{}], journal_lines: lines }, entries: [] }) as unknown as PocketShare;

describe('a share’s values that can’t be written as text', () => {
  it('are too big, not an error', () => {
    expect(shareProblem(share([{ journal_id: { toString: 1 }, memo: '' }]))).toEqual({ kind: 'too_big', table: 'journal_lines' });
    let deep: unknown = 'x';
    for (let i = 0; i < 50_000; i++) deep = [deep];
    expect(shareProblem(share([{ journal_id: '4a6c8e0b-2d4f-4a6b-8c0d-1e2f3a4b5c6d', memo: deep }]))).toEqual({ kind: 'too_big', table: 'journal_lines' });
  });

  it('measures an array of objects as the driver writes it', () => {
    expect(shareProblem(share([{ journal_id: '4a6c8e0b-2d4f-4a6b-8c0d-1e2f3a4b5c6d', memo: Array.from({ length: 16_000 }, () => ({})) }]))).toEqual({ kind: 'too_big', table: 'journal_lines' });
  });
});
