import { describe, expect, it } from 'vitest';
import { addDays, financialYear } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { expectCleanAudit, login, ref, setup } from './helpers.js';

// The eighth round of 1.33's reviews (IFRS), Pocket: what the seventh round's fixes left. Made-up business and figures.
const now = today();

describe('Pocket: moveToAccount in an agreed, closed year', () => {
  it('refuses moving a cost type whose one cost is in the closed year', async () => {
    const env = await setup();
    try {
      const owner = await login(env.app);
      const r = await ref(env.sql);
      const { settings } = await owner.get('/api/reference');
      const fy = financialYear(now, settings.fyEndMonth);
      const last = financialYear(addDays(fy.start, -1), settings.fyEndMonth);
      const petrol = await r.cat('Petrol');
      await owner.post('/api/costs', { date: addDays(fy.start, -30), description: 'Made-up fuel last year', supplier: 'Made-up Garage', amountCents: 30_000, categoryId: petrol, sourceId: await r.src('Business bank') });
      const agreed = await owner.call({ method: 'PUT', url: '/api/year-ends', payload: { fyEnd: last.end, note: 'Made-up sign-off', lock: true, figures: [] } });
      expect(agreed.statusCode, agreed.body).toBe(200);
      const fuel = await owner.post<{ id: string }>('/api/accounts', { code: '6950', name: 'Made-up Fuel', type: 'expense', active: true });
      const cat = (await env.sql<{ name: string; kind: string }[]>`select name, kind from cost_categories where id = ${petrol}`)[0]!;
      const res = await owner.call({ method: 'PUT', url: `/api/categories/${petrol}`, payload: { name: cat.name, kind: cat.kind, accountId: fuel.id } });
      expect(res.statusCode).toBe(400);
      await expectCleanAudit(env.sql);
    } finally {
      await env.close();
    }
  });
});

describe('Pocket: a company file’s settings, against Settings’ rules', () => {
  it('keeps a sole proprietor’s year to February, as Settings and Shap’s company file do', async () => {
    const env = await setup();
    try {
      const owner = await login(env.app);
      const res = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', settings: { businessType: 'sole_prop', fyEndMonth: 6 } } } });
      expect(res.statusCode, res.body).toBe(200);
      const [s] = await env.sql<{ businessType: string; fyEndMonth: number }[]>`select business_type, fy_end_month from settings where id`;
      expect(s).toEqual({ businessType: 'sole_prop', fyEndMonth: 2 });
      await expectCleanAudit(env.sql);
    } finally {
      await env.close();
    }
  });

  it('keeps turnover tax to a February year end', async () => {
    const env = await setup();
    try {
      const owner = await login(env.app);
      const res = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', settings: { businessType: 'company', fyEndMonth: 6, turnoverTax: true } } } });
      const [s] = await env.sql<{ fyEndMonth: number; turnoverTax: boolean }[]>`select fy_end_month, turnover_tax from settings where id`;
      expect(res.statusCode === 400 || !(s!.turnoverTax && s!.fyEndMonth !== 2), `${res.statusCode} ${JSON.stringify(s)}`).toBe(true);
      await expectCleanAudit(env.sql);
    } finally {
      await env.close();
    }
  });
});
