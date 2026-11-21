import { describe, expect, it } from 'vitest';
import { addDays, financialYear } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { exportCompanyFile } from '../src/modules/company-file.js';
import { expectCleanAudit, login, ref, setup } from './helpers.js';

// Round 9 (IFRS reviewer) probes of the eighth round's fixes, Pocket. Made-up business and figures.
const now = today();
type Env = Awaited<ReturnType<typeof setup>>;
const closedYear = (sql: Env['sql'], to: string) =>
  sql<{ code: string; t: number }[]>`select a.code, sum(l.amount_cents)::bigint as t from ledger l join accounts a on a.id = l.account_id
    where l.date <= ${to}::date and a.type <> 'equity' group by a.code having sum(l.amount_cents) <> 0 order by a.code`;

describe('Pocket: a cost type’s kind alone, with a closed year’s work in progress', () => {
  for (const via of ['settings', 'file'] as const)
    it(`${via}: refused, the closed year as it was`, async () => {
      const env = await setup();
      try {
        const owner = await login(env.app);
        const r = await ref(env.sql);
        const { settings } = await owner.get('/api/reference');
        const fy = financialYear(now, settings.fyEndMonth);
        const job = await owner.post<{ id: string }>('/api/projects', { name: 'Made-up Job', status: 'active' });
        const parts = await r.cat('Parts');
        await owner.post('/api/costs', { date: addDays(fy.start, -30), description: 'Made-up parts', supplier: 'Made-up Supplies', amountCents: 1_000_000, categoryId: parts, projectId: job.id, sourceId: await r.src('Business bank') });
        const lockTo = addDays(fy.start, -1);
        await env.sql`update settings set lock_date = ${lockTo}::date where id`;
        const [p] = await env.sql<{ accountId: string }[]>`select account_id from cost_categories where id = ${parts}`;
        const before = JSON.stringify(await closedYear(env.sql, lockTo));
        const res =
          via === 'settings'
            ? await owner.call({ method: 'PUT', url: `/api/categories/${parts}`, payload: { name: 'Parts', kind: 'overhead', accountId: p!.accountId } })
            : await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', categories: [{ name: 'Parts', kind: 'overhead', account: '5010' }] } } });
        expect({ status: res.statusCode, same: JSON.stringify(await closedYear(env.sql, lockTo)) === before }).toEqual({ status: 400, same: true });
        await expectCleanAudit(env.sql);
      } finally {
        await env.close();
      }
    });
});

describe('Pocket: its own company file, back into its books', () => {
  it('is taken after the new refusals (an agreed, closed year)', async () => {
    const env = await setup();
    try {
      const owner = await login(env.app);
      const r = await ref(env.sql);
      const { settings } = await owner.get('/api/reference');
      const fy = financialYear(now, settings.fyEndMonth);
      const last = financialYear(addDays(fy.start, -1), settings.fyEndMonth);
      await owner.post('/api/costs', { date: addDays(fy.start, -30), description: 'Made-up fuel', supplier: 'Made-up Garage', amountCents: 20_000, categoryId: await r.cat('Petrol'), sourceId: await r.src('Business bank') });
      const agreed = await owner.call({ method: 'PUT', url: '/api/year-ends', payload: { fyEnd: last.end, note: 'Made-up sign-off', lock: true, figures: [] } });
      expect(agreed.statusCode, agreed.body).toBe(200);
      const file = JSON.parse(JSON.stringify(await exportCompanyFile(env.sql)));
      const res = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file } });
      expect(res.statusCode, res.body).toBe(200);
      await expectCleanAudit(env.sql);
    } finally {
      await env.close();
    }
  });
});

describe('Pocket: a sole proprietor’s June books (an earlier file), a file brought in now', () => {
  it('moves the year to February: the agreed June year and the books audit', async () => {
    const env = await setup();
    try {
      const owner = await login(env.app);
      const r = await ref(env.sql);
      await env.sql`update settings set business_type = 'sole_prop', fy_end_month = 6 where id`;
      const fy = financialYear(now, 6);
      const last = financialYear(addDays(fy.start, -1), 6);
      await owner.post('/api/costs', { date: addDays(fy.start, -30), description: 'Made-up fuel', supplier: 'Made-up Garage', amountCents: 20_000, categoryId: await r.cat('Petrol'), sourceId: await r.src('Business bank') });
      const agreed = await owner.call({ method: 'PUT', url: '/api/year-ends', payload: { fyEnd: last.end, note: 'Made-up sign-off', lock: true, figures: [] } });
      expect(agreed.statusCode, agreed.body).toBe(200);
      const before = JSON.stringify(await closedYear(env.sql, last.end));
      const res = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', clients: [] } } });
      const [s] = await env.sql<{ m: number; lock: string }[]>`select fy_end_month as m, lock_date::text as lock from settings where id`;
      expect({ status: res.statusCode, m: s!.m }).toEqual({ status: 200, m: 2 });
      expect(JSON.stringify(await closedYear(env.sql, last.end))).toBe(before);
      await expectCleanAudit(env.sql);
      // SHOULD: the change of year end (IFRS for SMEs 3.10) is in the audit log, as Settings logs it. Fails today.
      const logged = await env.sql`select 1 from audit_log where details::text like '%fyEndMonth%'`;
      expect(logged.length).toBeGreaterThan(0);
    } finally {
      await env.close();
    }
  });
});
