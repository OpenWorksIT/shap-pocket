/**
 * What a share's file carries, held to what the panel says goes (SHARE_WHAT_GOES), from the check of
 * the fixes of Shap 1.29's and Pocket 1.11's reviews (Shap's CPDAUDIT.md): every record whatever its
 * date, the business's tax numbers and statement details, the logbook without its places. The same
 * books make the shares Shap's tests bring in (Shap's apps/server/test/fixtures/pocket-share-1.11*.json),
 * so the two apps are tested on one file: run with SHAP_FIXTURES set to that folder to write them
 * there. All data made up.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayOf, SHARE_WHAT_GOES } from '@shap/shared';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';
import type { ShareFile } from '../src/modules/share.js';
import { vat201 } from '../src/modules/taxforms.js';

describe('what a share carries, and what the panel says goes', () => {
  let env: TestEnv;
  let me: Awaited<ReturnType<typeof login>>;
  let r: Awaited<ReturnType<typeof ref>>;
  let one: ShareFile;
  let text: string;
  const share = async (n: number) => {
    const made = await me.post('/api/share');
    const res = await me.call({ method: 'GET', url: `/api/share/${made.number}/file` });
    expect(res.statusCode, res.body).toBe(200);
    if (process.env.SHAP_FIXTURES) writeFileSync(join(process.env.SHAP_FIXTURES, n === 1 ? 'pocket-share-1.11.json' : `pocket-share-1.11-${n}.json`), res.body);
    await me.post(`/api/share/${made.number}/sent`);
    return JSON.parse(res.body) as ShareFile;
  };

  beforeAll(async () => {
    env = await setup();
    // Someone named to approve the statements (the phone's user is "Owner" until they say: details.ts).
    await env.sql`update users set name = 'Made-up Owner' where name = 'Owner'`;
    me = await login(env.app);
    r = await ref(env.sql);
    const { settings } = await me.get('/api/reference');
    await me.post(
      '/api/settings',
      { ...settings, companyName: 'Made-up Mobile Sparky', businessType: 'company', vatRegistered: true, vatNumber: '4740101508', fyEndMonth: 2, taxNumber: '9100000000', features: { ...settings.features, sales: true, statements: true } },
      'PUT',
    );
    await env.sql`update brands set address = '7 Made-up Lane, Fictional Town'`;
    const bank = await r.src('Business bank');
    // A customer invoiced and paid, a cost with VAT, a day's labour, bank charges.
    const client = await me.post('/api/clients', { name: 'Made-up Guesthouse', email: 'guesthouse@example.co.za', phone: '0825550100', address: '1 Made-up Road' });
    const inv = await me.post('/api/documents', { kind: 'invoice', clientId: client.id, issueDate: '2026-10-05', lines: [{ category: 'labour', description: 'Rewiring (made up)', qty: 1, unitPriceCents: 100_000 }] });
    await me.post(`/api/documents/${inv.id}/issue`);
    await me.post(`/api/documents/${inv.id}/receipts`, { date: '2026-10-12', amountCents: 115_000, sourceId: bank });
    await me.post('/api/costs', { date: '2026-10-03', description: 'Cable (made up)', supplier: 'Made-up Wholesaler', amountCents: 23_000, vatCents: 3_000, vatCode: 'standard', categoryId: await r.cat('Parts'), sourceId: bank });
    const worker = await me.post('/api/workers', { name: 'Made-up Thabo', kind: 'casual', dayRateCents: 40_000, phone: '0825550199' });
    await me.post('/api/labour', { date: '2026-10-07', entries: [{ workerId: worker.id, days: 1, wageCents: 40_000 }] });
    const charges = (await env.sql<{ id: string }[]>`select id from accounts where code = '6030'`)[0]!.id;
    await me.post('/api/journals', { date: '2026-10-08', description: 'Made-up bank charges', lines: [{ accountId: charges, debitCents: 9_500 }, { accountId: await r.acc('bank'), creditCents: 9_500 }] });
    // A counter sale, half of it refunded: refunds and stock records are never changed on the phone.
    const till = (await env.sql<{ id: string }[]>`select id from payment_sources where till`)[0]!.id;
    const globe = await me.post('/api/items', { description: 'LED globe (made up)', unitPriceCents: 4_600, priceIncludesVat: true });
    const sale = await me.post('/api/sales', { date: '2026-10-10', sourceId: till, method: 'cash', lines: [{ itemId: globe.id, description: 'LED globe (made up)', qty: 2, unitPriceCents: 4_600 }] });
    const detail = await me.get(`/api/sales/${sale.id}`);
    await me.post(`/api/documents/${sale.id}/refund`, { date: '2026-10-11', sourceId: till, reason: 'Wrong fitting (made up)', lines: [{ lineId: detail.lines[0].id, qty: 1 }] });
    // A trip to a customer's home; an employee with their numbers; the statements' details.
    await me.post('/api/trips', { date: '2026-10-12', fromPlace: 'Made-up Depot', toPlace: '12 Made-up Close, Walmer', reason: 'Quote (made up)', km: 18 });
    await me.post('/api/employees', { name: 'Made-up Lindiwe', idNumber: '8001015009087', taxNumber: '0121212120', salaryCents: 1_000_000, startDate: '2026-03-01', bankDetails: 'Made-up Bank 000000' });
    await me.post('/api/statements/details', { directors: [{ name: 'Made-up Owner', role: 'Director' }], secretary: 'Made-up Secretary', registeredAddress: '3 Made-up Street, Fictional Town', bankers: 'Made-up Bankers' }, 'PUT');
    // A sole proprietor's kind of tax estimate, with their own income from elsewhere, and the logbook's year.
    await me.post('/api/tax-estimates', { fyEnd: '2027-02-28', period: 1, asAt: '2026-05-31', kind: 'individual', ageBand: '65to74', otherIncomeCents: 7_777_700, retirementCents: 3_333_300, payeCents: 1_212_100, note: 'Made-up note on a salary elsewhere', lines: [{ accountId: null, name: 'Sales', type: 'income', actualCents: 0, projectedCents: 30_000_000 }] });
    await me.post('/api/logbook/2027-02-28', { vehicle: 'Made-up bakkie CA 999-999', odometerStart: 100_000, odometerEnd: 130_000 }, 'PUT');
    // A cost dated after today.
    await me.post('/api/costs', { date: '2026-12-20', description: 'Later cost (made up)', supplier: 'Made-up Future', amountCents: 1_000, categoryId: await r.cat('Parts'), sourceId: bank });
    one = await share(1);
    text = JSON.stringify(one);
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('carries every record and every entry, whatever its date, as the panel says', () => {
    expect(one.records.costs!.some((c) => c.description === 'Later cost (made up)')).toBe(true);
    expect(one.entries.some((e) => e.key.endsWith(':2026-12-20'))).toBe(true);
    // Stamped with the day it was made, in South Africa.
    expect(one.stamp.through).toBe(dayOf(one.stamp.madeAt));
    expect(SHARE_WHAT_GOES).toMatch(/^One file of the whole of your books as at today/);
    expect(SHARE_WHAT_GOES).toMatch(/every invoice, cost, asset, pay run, journal, logbook trip and the rest, whatever its date/);
    expect(SHARE_WHAT_GOES).not.toMatch(/later share|dated up to/);
  });

  it('carries the business’s tax numbers and its statements’ details, and says so', () => {
    expect(text).toContain('9100000000');
    expect(SHARE_WHAT_GOES).toMatch(/its registration, VAT, PAYE, UIF and income tax numbers \(a sole proprietor’s income tax number is their own\)/);
    for (const goes of ['3 Made-up Street, Fictional Town', 'Made-up Secretary', 'Made-up Bankers']) expect(text).toContain(goes);
    expect(SHARE_WHAT_GOES).toMatch(/what you’ve filled in for its financial statements, such as directors, addresses, secretary and bankers/);
    // Who's paid goes, by name, with what payroll needs.
    for (const goes of ['Made-up Thabo', 'Made-up Lindiwe', 'Made-up Guesthouse']) expect(text).toContain(goes);
    expect(SHARE_WHAT_GOES).toMatch(/customers, suppliers, workers, employees, partners and shareholders and what you paid them \(and, for payroll, your employees’ age bands and medical aid members\)/);
  });

  it('leaves on the phone what the panel says it does: trips’ places, the vehicle, the tax estimates, the business’s address, people’s numbers and contact details', async () => {
    const trip = one.records.trips!.find((t) => t.km === 18)!;
    expect(trip).toMatchObject({ date: '2026-10-12', reason: 'Quote (made up)' });
    expect(trip).not.toHaveProperty('to_place');
    expect(trip).not.toHaveProperty('from_place');
    expect(one.records.logbook_years![0]).toMatchObject({ odometer_start: 100_000, odometer_end: 130_000 });
    expect(SHARE_WHAT_GOES).toMatch(/each trip’s date, kilometres and reason, and the logbook’s odometer readings/);
    // (On the phone, both are there.)
    expect((await env.sql<{ n: number }[]>`select count(*)::int as n from tax_estimates`)[0]!.n).toBe(1);
    expect((await env.sql<{ vehicle: string }[]>`select vehicle from logbook_years`)[0]!.vehicle).toBe('Made-up bakkie CA 999-999');
    expect(one.records).not.toHaveProperty('tax_estimates');
    for (const never of ['12 Made-up Close', 'Made-up Depot', '7 Made-up Lane', 'guesthouse@example.co.za', '0825550100', '1 Made-up Road', '0825550199', '8001015009087', '0121212120', 'Made-up Bank 000000', 'CA 999-999', '7777700', '3333300', '1212100', '65to74', 'salary elsewhere'])
      expect(text, never).not.toContain(never);
    expect(SHARE_WHAT_GOES).toMatch(
      /Left out: photos of your slips; your employees’ ID, tax and bank numbers; your customers’, workers’ and jobs’ contact details, addresses and notes; the address, phone, email and bank details in your settings and on your trading names; where your trips went from and to, and your vehicle’s name; and the tax estimates you’ve saved \(with any income from elsewhere\)\./,
    );
    expect(SHARE_WHAT_GOES).toMatch(/Nothing goes until you choose where to send or save it/);
  });

  it('carries the refund as it is, and the next share after it', async () => {
    expect(one.records.refunds).toHaveLength(1);
    // The VAT201 Shap's test expects of these books in its copy (FIXTURE_VAT there): the invoice
    // and the counter sale less the half refunded, VAT included, and the cable's VAT.
    expect(await vat201(env.sql, '2026-09-01', '2026-10-31')).toMatchObject({ field1: 119_600, field4: 15_600, field15: 3_000, field20: 12_600 });
    await me.post('/api/costs', { date: '2026-11-05', description: 'Tape (made up)', supplier: 'Made-up Wholesaler', amountCents: 1_500, categoryId: await r.cat('Parts'), sourceId: await r.src('Business bank') });
    const two = await share(2);
    expect(two.changes).toEqual({ added: 1, changed: 0, removed: 0 });
    expect(two.records.refunds).toEqual(one.records.refunds);
  });

  it('never offers a file Shap would refuse for a figure or text bigger than it keeps (the limits are shared)', async () => {
    await env.sql`update costs set note = repeat('x', 50001) where description = 'Cable (made up)'`;
    const res = await me.call({ method: 'POST', url: '/api/share' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/couldn’t make a share your accountant’s Shap can read/);
    await env.sql`update costs set note = '' where description = 'Cable (made up)'`;
  });
});
