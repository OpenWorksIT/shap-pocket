import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths, financialYear, vatPeriod } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { vat201 } from '../src/modules/taxforms.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

// From Shap's tenth review round of 1.33, in the code Pocket shares with it: a cost type's kind,
// into or out of asset, can't move a closed period's VAT between the VAT201's boxes 14 and 15.
// Made-up business, made-up figures.

describe('a cost type’s kind and a closed VAT period’s VAT201', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('keeps the closed period’s boxes 14 and 15 as they were', async () => {
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const { settings } = await owner.get('/api/reference');
    await owner.post('/api/settings', { ...settings, vatRegistered: true, vatNumber: '4000000002', vatCategory: 'C' }, 'PUT');
    const fy = financialYear(today(), settings.fyEndMonth);
    const p = vatPeriod(addMonths(fy.start, -3), 'C', settings.fyEndMonth);
    const [cat] = await env.sql<{ id: string; name: string; accountId: string }[]>`select id, name, account_id from cost_categories where kind = 'overhead' order by sort limit 1`;
    await owner.post('/api/costs', { date: p.start, description: 'Made-up tools', supplier: 'Made-up Supplies', amountCents: 115_000, vatCents: 15_000, categoryId: cat!.id, sourceId: await r.src('Business bank') });
    await env.sql`update settings set lock_date = ${p.end}::date where id`;
    const before = await vat201(env.sql, p.start, p.end);
    const res = await owner.call({ method: 'PUT', url: `/api/categories/${cat!.id}`, payload: { name: cat!.name, kind: 'asset', accountId: cat!.accountId, active: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/is in a closed period \(to .+\), so its account or kind can’t change/);
    expect(await vat201(env.sql, p.start, p.end)).toEqual(before);
    await env.sql`update settings set lock_date = null where id`;
  });
});
