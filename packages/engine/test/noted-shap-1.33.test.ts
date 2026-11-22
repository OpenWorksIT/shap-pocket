/**
 * What Shap's 1.33 CPD audit noted and didn't change, in the code Pocket shares, now fixed: an
 * asset made from a cost checks the cost's own period, a cost type's change of kind is logged with
 * what it moved, and a used payment account's history doesn't move to another line of the
 * statements. Each fails without its fix. Made-up business and figures.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

const now = today();

describe('checks and logging', () => {
  let env: TestEnv;
  let owner: Awaited<ReturnType<typeof login>>;
  let r: Awaited<ReturnType<typeof ref>>;
  beforeAll(async () => {
    env = await setup();
    owner = await login(env.app);
    r = await ref(env.sql);
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('checks the cost’s own date when an asset is made from it (figures)', async () => {
    const lock = addDays(now, -40);
    const cost = await owner.post<{ id: string }>('/api/costs', { date: addDays(lock, -5), description: 'Made-up drill', supplier: 'Made-up Tools', amountCents: 230_000, categoryId: await r.cat('Parts'), sourceId: await r.src('Business bank') });
    await env.sql`update settings set lock_date = ${lock}::date where id`;
    try {
      const res = await owner.call({ method: 'POST', url: '/api/assets', payload: { name: 'Made-up drill', category: 'tools', purchaseDate: addDays(now, -1), costCents: 1, costId: cost.id, lifeMonths: 36 } });
      expect(res.statusCode).toBe(400);
      expect(res.body).toMatch(/The books are closed up to/);
    } finally {
      await env.sql`update settings set lock_date = null where id`;
    }
  });

  it('logs what a cost type’s change of kind moves out of work in progress', async () => {
    const [cat] = await env.sql<{ id: string; name: string; accountId: string }[]>`select id, name, account_id from cost_categories where kind = 'materials' order by sort limit 1`;
    const client = await owner.post<{ id: string }>('/api/clients', { name: 'Made-up Job Client', address: '2 Made-up Street, Fictional Town' });
    const job = await owner.post<{ id: string }>('/api/projects', { name: 'Made-up open job', clientId: client.id });
    await owner.post('/api/costs', { date: addDays(now, -3), description: 'Made-up timber', supplier: 'Made-up Timber', amountCents: 80_000, categoryId: cat!.id, projectId: job.id, sourceId: await r.src('Business bank') });
    const res = await owner.call({ method: 'PUT', url: `/api/categories/${cat!.id}`, payload: { name: cat!.name, kind: 'overhead', accountId: cat!.accountId, active: true } });
    expect(res.statusCode).toBe(200);
    const [row] = await env.sql<{ details: { kindFrom: string; kindTo: string; posted: { account: { name: string }; cents: number }[] } }[]>`
      select details from audit_log where action = 'kind_changed' and entity_id = ${cat!.id}`;
    expect(row!.details).toMatchObject({ kindFrom: 'materials', kindTo: 'overhead' });
    const wip = row!.details.posted.find((p) => /work in progress/i.test(p.account.name));
    expect(wip?.cents).toBe(-80_000);
    expect(row!.details.posted.reduce((t, p) => t + p.cents, 0)).toBe(0);
    await owner.call({ method: 'PUT', url: `/api/categories/${cat!.id}`, payload: { name: cat!.name, kind: 'materials', accountId: cat!.accountId, active: true } });
  });

  it('refuses moving a used payment account’s history between two lines off cash, or from cash to the overdraft line', async () => {
    const holding = await owner.post<{ id: string }>('/api/accounts', { code: '1081', name: 'Made-up Holding', type: 'asset', active: true, statementLine: 'other_current_assets' });
    const deposit = await owner.post<{ id: string }>('/api/accounts', { code: '1082', name: 'Made-up Deposit', type: 'asset', active: true, statementLine: 'investments' });
    const src = await owner.post<{ id: string }>('/api/sources', { name: 'Made-up holding account', kind: 'bank', accountId: holding.id });
    await owner.post('/api/costs', { date: addDays(now, -2), description: 'Made-up fee', supplier: 'Made-up Bank', amountCents: 5_000, categoryId: await r.cat('Bank'), sourceId: src.id });
    const move = async (id: string, accountId: string, name: string) => owner.call({ method: 'PUT', url: `/api/sources/${id}`, payload: { name, kind: 'bank', accountId } });
    const a = await move(src.id, deposit.id, 'Made-up holding account');
    expect(a.statusCode).toBe(400);
    expect(a.json().error).toMatch(/^What’s already captured with this would move from the statements’ .+ line to .+ with it\. If the account it’s on now is on the wrong line, change that account’s line instead/);
    const overdraft = await owner.post<{ id: string }>('/api/accounts', { code: '2091', name: 'Made-up Overdraft', type: 'liability', active: true, statementLine: 'bank_overdraft' });
    const bank = await r.src('Business bank');
    await owner.post('/api/costs', { date: addDays(now, -2), description: 'Made-up fuel', supplier: 'Made-up Garage', amountCents: 40_000, categoryId: await r.cat('Petrol'), sourceId: bank });
    const b = await move(bank, overdraft.id, 'Business bank');
    expect(b.statusCode).toBe(400);
    expect(b.json().error).toMatch(/would move from the statements’ .+ line to .+ with it/);
    // Nothing captured with it yet: it moves.
    const unused = await owner.post<{ id: string }>('/api/sources', { name: 'Made-up unused', kind: 'bank', accountId: holding.id });
    expect((await move(unused.id, deposit.id, 'Made-up unused')).statusCode).toBe(200);
  });
});
