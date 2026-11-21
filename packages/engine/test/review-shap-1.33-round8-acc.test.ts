import { describe, expect, it } from 'vitest';
import { addDays, financialYear } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { expectCleanAudit, login, ref, setup } from './helpers.js';

// Round 8 (accounting): moving a cost type and changing its kind at once reaches a closed year's
// work in progress. Made-up business and figures.
const now = today();

describe('MUST: moving a cost type and changing its kind at once, with job costs in a closed year', () => {
  it('is refused: the closed year’s work in progress would go to an expense', async () => {
    const env = await setup();
    try {
      const owner = await login(env.app);
      const r = await ref(env.sql);
      const bank = await r.src('Business bank');
      const { settings } = await owner.get('/api/reference');
      const fy = financialYear(now, settings.fyEndMonth);
      const job = await owner.post<{ id: string }>('/api/projects', { name: 'Made-up Job', status: 'active' });
      const parts = await r.cat('Parts');
      await owner.post('/api/costs', { date: addDays(fy.start, -30), description: 'Made-up parts', supplier: 'Made-up Supplies', amountCents: 1_000_000, categoryId: parts, projectId: job.id, sourceId: bank });
      await env.sql`update settings set lock_date = ${addDays(fy.start, -1)}::date where id`;
      const closedYear = async () =>
        env.sql<{ code: string; t: string }[]>`select a.code, sum(l.amount_cents)::bigint as t from ledger l join accounts a on a.id = l.account_id
          where l.date <= ${addDays(fy.start, -1)}::date and a.type <> 'equity' group by a.code having sum(l.amount_cents) <> 0 order by a.code`;
      const before = await closedYear();
      const other = await owner.post<{ id: string }>('/api/accounts', { code: '6995', name: 'Made-up Sundry Costs', type: 'expense', active: true });
      const res = await owner.call({ method: 'PUT', url: `/api/categories/${parts}`, payload: { name: 'Parts', kind: 'overhead', accountId: other.id } });
      const after = await closedYear();
      expect({ status: res.statusCode, changed: JSON.stringify(after) !== JSON.stringify(before) }).toEqual({ status: 400, changed: false });
      await env.sql`update settings set lock_date = null where id`;
      await expectCleanAudit(env.sql);
    } finally {
      await env.close();
    }
  });
});
