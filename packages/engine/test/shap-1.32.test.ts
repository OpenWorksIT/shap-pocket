/**
 * Shap 1.32.0's reviews, in the code Shap Pocket shares (statements/build.ts, statements/details.ts,
 * shared vat.ts, setup.ts, terms.ts): time tracked up to the year end that wasn't invoiced by then is
 * listed for the accountant (IFRS for SMEs 23.14), and the revenue policy doesn't say all work is
 * invoiced as it's done when it isn't; an amount paid as the client's agent is no supply (VAT Act
 * s54(2)); a business with more than 20% of its receipts from professional services can't be on
 * turnover tax (Sixth Schedule para 3(b)). Each failed on 1.11.2. All data made up.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SALE_VAT, setupCautions, TURNOVER_TAX_PROFESSIONAL } from '@shap/shared';
import { buildStatements } from '../src/statements/build.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

const FY = '2026-02-28';
let env: TestEnv;
let open = false;
afterEach(async () => {
  if (open) {
    await expectCleanAudit(env.sql, FY);
    await env.close();
  }
  open = false;
});

/** The accounting policies note's words (note 1). */
const policyText = (s: Awaited<ReturnType<typeof buildStatements>>) => s.notes.find((n) => n.key === 'policies')!.paragraphs.join(' ');

/** A consultant's year: some time invoiced in it, and (or not) some time tracked at its end that wasn't. */
const yearWith = async (unbilledHours: number) => {
  env = await setup();
  open = true;
  const me = await login(env.app);
  const { settings } = await me.get('/api/reference');
  await me.post('/api/settings', { ...settings, companyName: 'Fictional Consulting', businessType: 'sole_prop', fyEndMonth: 2, hourlyRateCents: 50_000, features: { ...settings.features, timeTracker: true, statements: true } }, 'PUT');
  const r = await ref(env.sql);
  await me.post('/api/journals', { date: '2025-04-01', description: 'Made-up capital', lines: [{ accountId: await r.acc('bank'), debitCents: 100_000 }, { accountId: await r.acc('owner_loan'), creditCents: 100_000 }] });
  // Billed within the year: not "unbilled".
  const t = await me.post('/api/time', { projectId: null, startedAt: '2025-06-02T08:00:00+02:00', endedAt: '2025-06-02T10:00:00+02:00', note: 'Made-up work' });
  const inv = await me.post('/api/documents', { kind: 'invoice', issueDate: '2025-06-03', lines: [] });
  await me.post('/api/time/bill', { documentId: inv.id, ids: [t.id] });
  await me.post(`/api/documents/${inv.id}/issue`, {});
  if (unbilledHours) await me.post('/api/time', { projectId: null, startedAt: '2026-02-26T08:00:00+02:00', endedAt: `2026-02-26T${String(8 + unbilledHours).padStart(2, '0')}:00:00+02:00`, note: 'Made-up year-end work' });
  return buildStatements(env.sql, FY);
};

describe('as Shap 1.32 has it', () => {
  it('lists time not invoiced by the year end, with its value, and words the revenue policy to fit', async () => {
    const s = await yearWith(3);
    const item = s.checks.find((c) => /not invoiced by the year end/.test(c.label));
    expect(item).toMatchObject({ ok: false, level: 'look' });
    expect(item!.detail).toMatch(/^3 hours of time tracked in the year \(or before it and invoiced only after the year end\) weren’t on an invoice issued by the year end \(R\s?1[\s,]?500\.00 at the hourly rates in Shap\)\. If that work was for clients and will be billed, consider accruing the revenue/);
    expect(policyText(s)).toMatch(/Revenue from services is recognised as the work is performed\./);
    expect(policyText(s)).not.toMatch(/invoices its work as it is done/);
  });

  it('says nothing of it, and keeps the policy as it was, when all the time was invoiced', async () => {
    const s = await yearWith(0);
    expect(s.checks.find((c) => /not invoiced by the year end/.test(c.label))).toBeUndefined();
    expect(policyText(s)).toMatch(/which is when it is invoiced: the business invoices its work as it is done/);
  });

  it('counts time on a quote an invoice was made from as invoiced, and leaves out earlier years’ time never invoiced (the check of the fixes)', async () => {
    await yearWith(0);
    const me = await login(env.app);
    const q = await me.post('/api/time', { projectId: null, startedAt: '2025-09-01T08:00:00+02:00', endedAt: '2025-09-01T12:00:00+02:00', note: 'Made-up quoted work' });
    const quote = await me.post('/api/documents', { kind: 'quote', issueDate: '2025-09-02', lines: [] });
    await me.post('/api/time/bill', { documentId: quote.id, ids: [q.id] });
    const inv = await me.post(`/api/documents/${quote.id}/convert`, {});
    // The invoice dated in the year (the draft is dated the day it's made).
    await env.sql`update documents set issue_date = '2025-09-10' where id = ${inv.id}`;
    await me.post(`/api/documents/${inv.id}/issue`, {});
    await me.post('/api/time', { projectId: null, startedAt: '2023-06-02T08:00:00+02:00', endedAt: '2023-06-02T09:00:00+02:00', note: 'Made-up old admin' });
    const s = await buildStatements(env.sql, FY);
    expect(s.checks.find((c) => /not invoiced by the year end/.test(c.label))).toBeUndefined();
    expect(policyText(s)).toMatch(/which is when it is invoiced: the business invoices its work as it is done/);
  });

  it('says an amount paid as the client’s agent is no supply, and turnover tax isn’t for professional services', () => {
    expect(SALE_VAT.exempt.hint).toMatch(/A fee you pay in a client’s name as their agent and recover at cost is generally neither your supply nor your revenue\. Shap counts every invoice line as revenue, so leave it off your Shap invoices/);
    expect(TURNOVER_TAX_PROFESSIONAL).toMatch(/more than 20% of its receipts from professional services/);
    expect(TURNOVER_TAX_PROFESSIONAL).toMatch(/for a company, its investment income counts too/);
    expect(setupCautions({ vatRegistered: false, employees: false, turnoverTax: true }).join(' ')).toContain(TURNOVER_TAX_PROFESSIONAL);
  });
});
