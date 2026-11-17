/**
 * Share with your accountant: the books' own records as one stamped file, each share saying what
 * changed since the last one shared, with the findings of the reviews of Shap 1.29 and Pocket 1.11
 * (Shap's CPDAUDIT.md) each tested. All data made up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatDate, pocketShareMessage, pocketShareSchema, SHARE_TABLE_NAMES, SHARE_WHAT_GOES } from '@shap/shared';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';
import { BOOKS_DONT_BALANCE, type ShareFile } from '../src/modules/share.js';

describe('sharing the books with the accountant', () => {
  let env: TestEnv;
  let me: Awaited<ReturnType<typeof login>>;
  let r: Awaited<ReturnType<typeof ref>>;
  let cost: { id: string };
  const share = async (send = true): Promise<ShareFile> => {
    const made = await me.post('/api/share');
    const res = await me.call({ method: 'GET', url: `/api/share/${made.number}/file` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".* share \d+ \d{4}-\d{2}-\d{2}\.json"/);
    const f = JSON.parse(res.body) as ShareFile;
    // What Shap reads: the one schema both use.
    expect(pocketShareSchema.safeParse(f).success).toBe(true);
    expect(made.entries).toBe(f.entries.length);
    if (send) await me.post(`/api/share/${made.number}/sent`);
    return f;
  };

  beforeAll(async () => {
    env = await setup();
    me = await login(env.app);
    r = await ref(env.sql);
    const client = await me.post('/api/clients', { name: 'Made-up Guesthouse', email: 'guesthouse@example.co.za', phone: '0825550100', address: '1 Made-up Road' });
    const inv = await me.post('/api/documents', { kind: 'invoice', clientId: client.id, issueDate: '2026-10-05', lines: [{ category: 'labour', description: 'Rewiring (made up)', qty: 1, unitPriceCents: 100_000 }] });
    await me.post(`/api/documents/${inv.id}/issue`);
    // A credit note: its entries' keys have an underscore in their source (credit_note:…).
    const cn = await me.post(`/api/documents/${inv.id}/credit-note`);
    await me.post(`/api/documents/${cn.id}`, { issueDate: '2026-10-06', creditReason: 'Made-up overcharge', lines: [{ category: 'labour', description: 'Rewiring (made up)', qty: 1, unitPriceCents: 10_000 }] }, 'PUT');
    await me.post(`/api/documents/${cn.id}/issue`);
    cost = await me.post('/api/costs', { date: '2026-10-03', description: 'Cable (made up)', supplier: 'Made-up Wholesaler', amountCents: 23_000, categoryId: await r.cat('Parts'), sourceId: await r.src('Business bank') });
    // A worker paid by the day, and an employee with ID, tax and bank numbers (none of which leave the phone).
    const worker = await me.post('/api/workers', { name: 'Made-up Thabo', kind: 'casual', dayRateCents: 40_000, phone: '0825550199' });
    await me.post('/api/labour', { date: '2026-10-07', entries: [{ workerId: worker.id, days: 1, wageCents: 40_000 }] });
    await me.post('/api/employees', { name: 'Made-up Lindiwe', idNumber: '', taxNumber: '', salaryCents: 1_000_000, startDate: '2026-03-01', bankDetails: 'Made-up Bank 000000' });
    // A journal with two lines on one account, and a long description and memo.
    await me.post('/api/journals', {
      date: '2026-10-08',
      description: `Made-up correction ${'x'.repeat(280)}`,
      lines: [
        { accountId: await r.acc('suspense'), debitCents: 300, memo: `First ${'y'.repeat(190)}` },
        { accountId: await r.acc('suspense'), debitCents: 200, memo: 'Second' },
        { accountId: await r.acc('bank'), creditCents: 500, memo: '' },
      ],
    });
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('carries the books’ records, stamped with these books’ id, and every entry’s hashes', async () => {
    expect((await me.get('/api/share')).last).toBeNull();
    const f = await share();
    expect(f.format).toBe('shap-pocket-share/1');
    expect(f.stamp).toMatchObject({ number: 1, previous: null, app: 'Shap Pocket' });
    const [s] = await env.sql<{ booksId: string }[]>`select books_id from settings where id`;
    expect(f.stamp.books).toBe(s!.booksId);
    expect(Object.keys(f.records).sort()).toEqual([...SHARE_TABLE_NAMES].sort());
    expect(f.records.accounts!.some((a) => a.code === '1000')).toBe(true);
    // Read as the database has them: snake_case columns, the credit note's own kind.
    expect(f.records.documents!.some((d) => d.kind === 'credit_note' && 'credited_invoice_id' in d)).toBe(true);
    expect(f.entries.length).toBeGreaterThan(4);
    expect(f.entries.every((e) => /^[0-9a-f]{64}$/.test(e.hash) && /^[0-9a-f]{64}$/.test(e.figures))).toBe(true);
    // The first share has nothing to compare with.
    expect(f.changes).toEqual({ added: 0, changed: 0, removed: 0 });
  });

  it('leaves out who signs in, photos of slips, and people’s numbers and contact details (security P2, words 1)', async () => {
    const f = await share();
    expect(f.records).not.toHaveProperty('users');
    expect(f.records).not.toHaveProperty('attachments');
    const text = JSON.stringify(f);
    for (const never of ['guesthouse@example.co.za', '0825550100', '1 Made-up Road', '0825550199', 'Made-up Bank 000000']) expect(text).not.toContain(never);
    const emp = f.records.employees!.find((e) => e.name === 'Made-up Lindiwe')!;
    expect(emp).not.toHaveProperty('id_number');
    expect(emp).not.toHaveProperty('bank_details');
    expect(f.records.journals!.every((j) => j.created_by === null)).toBe(true);
    // What does go, and the panel says so: the workers paid, by name.
    expect(text).toContain('Made-up Thabo');
    // (What goes, said in full, is held to a file in share-file.test.ts.)
    expect(SHARE_WHAT_GOES).toMatch(/customers, suppliers, workers, employees, partners and shareholders and what you paid them/);
    expect(SHARE_WHAT_GOES).toMatch(/Left out: photos of your slips; your employees’ ID, tax and bank numbers; your customers’, workers’ and jobs’ contact details/);
  });

  it('says nothing changed when nothing did: credit notes and lines in any order (accounting 2 and 3)', async () => {
    await share();
    expect((await me.get('/api/share')).changedSince).toBe(0);
    const again = await share();
    expect(again.changes).toEqual({ added: 0, changed: 0, removed: 0 });
  });

  it('counts an entry moved to another day as one changed entry (accounting 6)', async () => {
    await me.post(`/api/costs/${cost.id}`, { date: '2026-10-04', description: 'Cable (made up)', supplier: 'Made-up Wholesaler', amountCents: 23_000, categoryId: await r.cat('Parts'), sourceId: await r.src('Business bank') }, 'PUT');
    expect((await me.get('/api/share')).changedSince).toBe(1);
    const f = await share();
    expect(f.changes).toEqual({ added: 0, changed: 1, removed: 0 });
  });

  it('counts a share only once it’s shared, and keeps its file only until then', async () => {
    const pending = await share(false);
    const next = await share();
    expect(next.stamp.previous?.number).toBe(pending.stamp.number - 1);
    expect((await me.call({ method: 'GET', url: `/api/share/${next.stamp.number}/file` })).statusCode).toBe(404);
    expect((await me.call({ method: 'POST', url: '/api/share/999/sent' })).statusCode).toBe(404);
  });

  it('the share sheet’s message says each share is the whole of the books (words 6)', () => {
    expect(pocketShareMessage({ number: 3, through: '2026-11-17', previous: 2, changes: 2 }, formatDate)).toBe(`Share 3: the whole of the books as at ${formatDate('2026-11-17')}, with 2 changes since share 2.`);
    expect(pocketShareMessage({ number: 1, through: '2026-11-17', previous: null, changes: 0 }, formatDate)).toBe(`Share 1: the whole of the books as at ${formatDate('2026-11-17')}.`);
  });

  it('says where to look, and that it’s a fault, when the books don’t balance (words 9)', () => {
    expect(BOOKS_DONT_BALANCE).toMatch(/Settings → Checks & audit log shows by how much\)\. That shouldn’t happen: please let us know/);
  });
});
