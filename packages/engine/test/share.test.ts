/**
 * Share with your accountant: the whole of the books as one stamped file, each share saying what
 * changed since the last one sent. All data made up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pocketShareSchema } from '@shap/shared';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';
import type { ShareFile } from '../src/modules/share.js';

describe('sharing the books with the accountant', () => {
  let env: TestEnv;
  let me: Awaited<ReturnType<typeof login>>;
  const share = async (): Promise<ShareFile> => {
    const made = await me.post('/api/share');
    const r = await me.call({ method: 'GET', url: `/api/share/${made.number}/file` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename=".* share \d+ \d{4}-\d{2}-\d{2}\.json"/);
    const f = JSON.parse(r.body) as ShareFile;
    // What Shap reads: the one schema both use.
    expect(pocketShareSchema.safeParse(f).success).toBe(true);
    expect([made.transactions, made.changes.added]).toEqual([f.totals.transactions, f.changes.added.length]);
    return f;
  };

  beforeAll(async () => {
    env = await setup();
    me = await login(env.app);
    const r = await ref(env.sql);
    const client = await me.post('/api/clients', { name: 'Made-up Guesthouse' });
    const inv = await me.post('/api/documents', { kind: 'invoice', clientId: client.id, issueDate: '2026-10-05', lines: [{ category: 'labour', description: 'Rewiring (made up)', qty: 1, unitPriceCents: 100_000 }] });
    await me.post(`/api/documents/${inv.id}/issue`);
    await me.post('/api/costs', { date: '2026-10-03', description: 'Cable (made up)', supplier: 'Made-up Wholesaler', amountCents: 23_000, categoryId: await r.cat('Parts'), sourceId: await r.src('Business bank') });
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('shares every posting, by transaction, balanced, with the business’s details and its accounts', async () => {
    expect((await me.get('/api/share')).last).toBeNull();
    const f = await share();
    expect(f.format).toBe('shap-pocket-share/1');
    expect(f.stamp).toMatchObject({ number: 1, previous: null, app: 'Shap Pocket' });
    expect(f.business.fyEndMonth).toBeGreaterThan(0);
    expect(f.accounts.some((a) => a.code === '1000')).toBe(true);
    const invoice = f.transactions.find((t) => t.source === 'invoice')!;
    expect(invoice.reference).toMatch(/\S/);
    expect(invoice.lines.reduce((s, l) => s + l.cents, 0)).toBe(0);
    expect(f.transactions.reduce((s, t) => s + t.lines.reduce((x, l) => x + l.cents, 0), 0)).toBe(0);
    // The first share has nothing to compare with.
    expect(f.changes).toEqual({ added: [], changed: [], removed: [] });
  });

  it('counts a share only once it’s sent, and the next says what changed since', async () => {
    // Share 1 wasn't sent (the share sheet was cancelled): share 2 still has nothing to compare with.
    const two = await share();
    expect([two.stamp.number, two.stamp.previous]).toEqual([2, null]);
    await me.post(`/api/share/${two.stamp.number}/sent`);
    expect((await me.get('/api/share')).last.number).toBe(2);
    expect((await me.get('/api/share')).changedSince).toBe(0);
    // A new cost since the last one sent.
    const r = await ref(env.sql);
    await me.post('/api/costs', { date: '2026-10-10', description: 'Conduit (made up)', supplier: 'Made-up Wholesaler', amountCents: 5_000, categoryId: await r.cat('Parts'), sourceId: await r.src('Business bank') });
    expect((await me.get('/api/share')).changedSince).toBe(1);
    const three = await share();
    expect(three.stamp.previous).toMatchObject({ number: 2 });
    expect(three.changes.added).toHaveLength(1);
    expect(three.changes.removed).toEqual([]);
    expect(three.transactions.find((t) => t.key === three.changes.added[0])!.description).toMatch(/Conduit/);
  });

  it('keeps a share’s file only until it’s sent', async () => {
    const made = await me.post('/api/share');
    await me.post(`/api/share/${made.number}/sent`);
    expect((await me.call({ method: 'GET', url: `/api/share/${made.number}/file` })).statusCode).toBe(404);
    expect((await me.call({ method: 'POST', url: '/api/share/99/sent' })).statusCode).toBe(404);
  });
});
