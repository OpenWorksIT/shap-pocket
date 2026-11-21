import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { journalInput, vatPeriod } from '@shap/shared';
import { auditBooks } from '../src/audit/books.js';
import { today } from '../src/lib/books.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

// From Shap's fifth security review of 1.33, in the code Pocket shares with it: VAT on journals
// typed in is read once for each journal, not once for each of its VAT lines (one very long journal
// made the VAT201 and the books audit take seconds on end), and a journal takes up to 1 000 lines.
// Made-up business, made-up figures.

describe('VAT on journals typed in, on one very long journal', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('the VAT201 and the books audit answer in good time, and count only the cash sale', async () => {
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const { settings } = await owner.get('/api/reference');
    await owner.post('/api/settings', { ...settings, vatRegistered: true, vatNumber: '4000000002', vatCategory: 'C' }, 'PUT');
    const p = vatPeriod(today(), 'C', settings.fyEndMonth);
    // One made-up journal of 2 000 one-cent VAT lines paid from the bank (as journals took before
    // the cap: one may already be in the books), and a cash sale journalled beside it.
    const [u] = await env.sql<{ id: string }[]>`select id from users limit 1`;
    const [j] = await env.sql<{ id: string }[]>`insert into journals (date, description, reference, kind, created_by) values (${p.start}, 'Made-up long journal', '', 'manual', ${u!.id}) returning id`;
    await env.sql`insert into journal_lines (journal_id, account_id, debit_cents, credit_cents, memo)
      select ${j!.id}::uuid, ${await r.acc('vat')}::uuid, 1, 0, '' from generate_series(1, 2000)
      union all select ${j!.id}::uuid, ${await r.acc('bank')}::uuid, 0, 2000, ''`;
    await owner.post('/api/journals', { date: p.start, description: 'Made-up cash sale', lines: [{ accountId: await r.acc('bank'), debitCents: 115_000 }, { accountId: await r.acc('revenue_other'), creditCents: 100_000 }, { accountId: await r.acc('vat'), creditCents: 15_000 }] });
    let t = Date.now();
    const v = await owner.get<{ handVatAddedCents: number; handVatOffCents: number; handVatLines: number }>(`/api/vat/return?on=${p.start}`);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(v).toMatchObject({ handVatAddedCents: 15_000, handVatOffCents: 0, handVatLines: 1 });
    t = Date.now();
    await auditBooks(env.sql);
    expect(Date.now() - t).toBeLessThan(3000);
    await env.sql`delete from journals where id = ${j!.id}`;
  });

  it('takes a journal of up to 1 000 lines, and says to split a longer one', () => {
    const lines = (n: number) => [...Array.from({ length: n - 1 }, () => ({ accountId: '00000000-0000-4000-8000-000000000001', creditCents: 1 })), { accountId: '00000000-0000-4000-8000-000000000002', debitCents: n - 1 }];
    expect(journalInput.safeParse({ date: today(), description: 'Made-up', lines: lines(1000) }).success).toBe(true);
    const r = journalInput.safeParse({ date: today(), description: 'Made-up long journal', lines: lines(1001) });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).toContain('A journal takes up to 1 000 lines: split a longer one into journals that each balance');
  });
});
