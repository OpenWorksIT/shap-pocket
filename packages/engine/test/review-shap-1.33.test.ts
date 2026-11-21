import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, financialYear, latePayNote, noIncomeTaxWords, termsPoints, vatPeriod } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { fingerprints, parseStatementAmount } from '../src/modules/bank/parse.js';
import { findRecurring } from '../src/modules/recurring.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

// From Shap's reviews of 1.33, in the code Pocket shares with it: amounts written -.50 and
// 1.234,56, a fingerprint short enough for the database, a monthly cost paid the way it was last
// paid, and what you're responsible for filing. Made-up business, made-up figures.

describe('reading a statement', () => {
  it('reads amounts written -.50 and 1.234,56', () => {
    expect(parseStatementAmount('-.50')).toBe(-50);
    expect(parseStatementAmount('1.234,56')).toBe(123_456);
    expect(parseStatementAmount('1,234.56')).toBe(123_456);
    expect(parseStatementAmount('-1 234,56')).toBe(-123_456);
  });

  it('keeps a fingerprint short however long the description, and the same for an ordinary one', () => {
    const [key] = fingerprints([{ date: '2026-04-03', amountCents: -100, description: 'x9'.repeat(5000), balanceCents: null }]);
    expect(key!.length).toBeLessThan(2100);
    expect(fingerprints([{ date: '2026-04-03', amountCents: -100, description: 'Made-up Garage', balanceCents: null }])).toEqual(['2026-04-03|-100|madeupgarage|1']);
  });
});

describe('a monthly cost, paid the way it was last paid', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const bank = await r.src('Business bank');
    const [cardAcc] = await env.sql<{ id: string }[]>`insert into accounts (code, name, type) values ('2310', 'Business card (made-up)', 'liability') returning id`;
    const card = (await owner.post('/api/sources', { name: 'Made-up card', kind: 'card', accountId: cardAcc!.id })).id;
    const first = `${today().slice(0, 8)}01`;
    // On the card for three months, then the bank for the last two.
    for (let i = 5; i >= 1; i--) await owner.post('/api/costs', { date: `${addMonths(first, -i).slice(0, 8)}12`, description: 'Subscription', amountCents: 50_000, supplier: 'Made-up Software', categoryId: (await env.sql<{ id: string }[]>`select id from cost_categories where kind = 'overhead' order by sort limit 1`)[0]!.id, sourceId: i > 2 ? card : bank });
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('is the bank’s now', async () => {
    const bank = await (await ref(env.sql)).src('Business bank');
    const sub = (await findRecurring(env.sql, today())).find((x) => x.label === 'Made-up Software');
    expect(sub?.sourceId).toBe(bank);
  });
});

describe('what you file and pay', () => {
  it('names CIPC and the Compensation Fund with SARS and the Department of Employment and Labour', () => {
    const filing = termsPoints('pocket').find((p) => p.title === 'You are responsible for what you file and pay')!;
    expect(filing.body).toMatch(/SARS, the Department of Employment and Labour, CIPC and the Compensation Fund/);
  });
});

describe('Home’s tiles: revenue first, and gross profit as the income statement’s', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const bank = await r.src('Business bank');
    const day = addDays(today(), -3);
    const client = await owner.post('/api/clients', { name: 'Made-up Client' });
    const inv = await owner.post('/api/documents', { kind: 'invoice', clientId: client.id, issueDate: day, lines: [{ category: 'labour', description: 'Work', qty: 1, unitPriceCents: 1_000_000 }] });
    await owner.post(`/api/documents/${inv.id}/issue`);
    await owner.post('/api/costs', { date: day, description: 'Made-up parts', supplier: 'Made-up Supplies', amountCents: 300_000, categoryId: await r.cat('Parts'), sourceId: bank });
    await owner.post('/api/journals', { date: day, description: 'Interest (made up)', lines: [{ accountId: await r.acc('bank'), debitCents: 500_000 }, { accountId: await r.acc('interest_income'), creditCents: 500_000 }] });
    // Interest paid: a finance cost, apart from running costs. Income tax booked: apart too.
    await owner.post('/api/costs', { date: day, description: 'Made-up interest', supplier: 'Made-up Bank', amountCents: 20_000, categoryId: await r.cat('Interest'), sourceId: bank });
    await owner.post('/api/journals', { date: day, description: 'Income tax (made up)', lines: [{ accountId: await r.acc('income_tax'), debitCents: 10_000 }, { accountId: await r.acc('bank'), creditCents: 10_000 }] });
    // A running cost dated tomorrow: not "to date" yet, whatever day of the month it is.
    await owner.post('/api/costs', { date: addDays(today(), 1), description: 'Made-up cover', supplier: 'Made-up Insurer', amountCents: 70_000, categoryId: await r.cat('Insurance'), sourceId: bank });
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('leaves interest out of revenue and gross profit, and the tiles add up', async () => {
    const owner = await login(env.app);
    const y = (await owner.get('/api/dashboard')).yearToDate;
    expect(y.revenueCents).toBe(1_000_000);
    expect(y.grossProfitCents).toBe(700_000);
    expect(y.otherIncomeCents).toBe(500_000);
    expect(y.financeCostsCents).toBe(20_000);
    expect(y.runningCostsCents).toBe(0);
    expect(y.incomeTaxCents).toBe(10_000);
    expect(y.grossProfitCents + y.otherIncomeCents - y.runningCostsCents - y.financeCostsCents - y.incomeTaxCents).toBe(y.profitCents);
    expect(y.profitCents).toBe(700_000 + 500_000 - 20_000 - 10_000);
    const home = readFileSync(join(__dirname, '..', '..', '..', 'apps', 'web', 'src', 'pages', 'Home.tsx'), 'utf8');
    expect(home).toMatch(/`Revenue \$\{data\.financialYear\.label\} to date`/);
    // The words (Shap 1.33's fourth round): as the income statement sets them out, tax as captured,
    // before tax when none is, and that they're rough guides, not advice.
    expect(home).toMatch(/of revenue \(revenue less cost of sales, as the income statement sets them out\)`/);
    expect(home).toMatch(/income tax as captured in the books`/);
    expect(home).toMatch(/\(data\.yearToDate\.incomeTaxCents \? '' : noIncomeTaxWords\(settings\)\)/);
    // By who pays it: a sole proprietor's tax is their own, never "not yet" in the books.
    expect(noIncomeTaxWords({ businessType: 'sole_prop' })).toBe('; the owner’s own income tax isn’t in the business’s books');
    expect(noIncomeTaxWords({ businessType: 'partnership' })).toBe('; the partners’ own income tax isn’t in the business’s books');
    expect(noIncomeTaxWords({ businessType: 'company' })).toBe('; before income tax (none captured in the books: your accountant works it out)');
    expect(noIncomeTaxWords({ businessType: 'company', turnoverTax: true })).toBe('');
    expect(home).toMatch(/<p className="xs muted">\{PROFIT_NOTE\}<\/p>/);
    expect(home).toMatch(/PROFIT_NOTE = 'Worked out from what’s captured in the books, to today\. Rough guides to plan with, not advice\.'/);
  });
});

describe('a pay date a year off, a run paid late, and one that’s final', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('refuses a pay date a year off its month, on a new run or a draft moved', async () => {
    const owner = await login(env.app);
    const bank = await (await ref(env.sql)).src('Business bank');
    const { settings: s } = await owner.get('/api/reference');
    await owner.post('/api/settings', { ...s, features: { ...s.features, payroll: true } }, 'PUT');
    await owner.post('/api/employees', { name: 'Made-up Employee', salaryCents: 2_000_000, startDate: '2025-01-01' });
    const r = await owner.call({ method: 'POST', url: '/api/pay-runs', payload: { period: '2026-11', payDate: '2025-11-25', sourceId: bank } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/^Shap Pocket takes a pay date for November 2026 from .*isn’t, so it may be a slip of the year or month\. For pay that really was that early or late, ask your accountant how to record it\./);
    const run = await owner.post<{ id: string }>('/api/pay-runs', { period: '2026-10', payDate: '2026-10-25', sourceId: bank });
    const moved = await owner.call({ method: 'PUT', url: `/api/pay-runs/${run.id}`, payload: { payDate: '2027-10-25', sourceId: bank } });
    expect(moved.statusCode).toBe(400);
    expect(moved.json().error).toMatch(/slip of the year or month/);
    // Final: it says so, whatever the date.
    await owner.post(`/api/pay-runs/${run.id}/finalise`);
    const put = await owner.call({ method: 'PUT', url: `/api/pay-runs/${run.id}`, payload: { payDate: '2024-10-25', sourceId: bank } });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toMatch(/^This pay run is final\. Reopen it to change it\.$/);
  });

  it('says which EMP201 is the accountant’s to check for a run paid more than a month late', () => {
    expect(latePayNote('2026-10', '2026-11-30')).toBeNull();
    expect(latePayNote('2026-10', '2026-12-01')).toBe('The pay date is more than a month after October 2026. Employees’ tax arises when the business pays the salary, or becomes liable to pay it, so which EMP201 this goes on is for your accountant to check: Shap Pocket puts it on the EMP201 for the month it’s paid.');
    expect(latePayNote('2027-01', '2027-04-25')).toMatch(/and which tax year’s tables,/);
    expect(latePayNote('2027-02', '2027-03-05')).toMatch(/^The pay date is in the tax year after February 2027’s \(from 1 March\)\./);
    const page = readFileSync(join(__dirname, '..', '..', '..', 'apps', 'web', 'src', 'pages', 'Payroll.tsx'), 'utf8');
    expect(page).toMatch(/<Field label="Pay date" hint=\{latePayNote\(run\.period, run\.payDate\) \?\? undefined\}>/);
  });
});

// Shap 1.33's fourth round (IFRS): Pocket doesn't move an account onto the cash line (whether it's
// cash is a judgement), and the books audit says so, with the test for an asset and a liability.
describe('a bank account that isn’t on the cash line', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('keeps the line it was given, renamed or moved, an asset’s or a liability’s', async () => {
    const owner = await login(env.app);
    const lineOf = async (code: string) => (await env.sql<{ l: string }[]>`select statement_line as l from accounts where code = ${code}`)[0]!.l;
    const acc = await owner.post<{ id: string }>('/api/accounts', { code: '1070', name: 'Made-up Savings', type: 'asset', active: true });
    const src = await owner.post<{ id: string }>('/api/sources', { name: 'Made-up savings', kind: 'bank', accountId: acc.id });
    expect(await lineOf('1070')).toBe('other_current_assets');
    await owner.post(`/api/sources/${src.id}`, { name: 'Made-up savings (renamed)', kind: 'bank', accountId: acc.id }, 'PUT');
    expect(await lineOf('1070')).toBe('other_current_assets');
    const other = await owner.post<{ id: string }>('/api/accounts', { code: '1071', name: 'Made-up Savings Two', type: 'asset', active: true });
    await owner.post(`/api/sources/${src.id}`, { name: 'Made-up savings (renamed)', kind: 'bank', accountId: other.id }, 'PUT');
    expect(await lineOf('1071')).toBe('other_current_assets');
    const od = await owner.post<{ id: string }>('/api/accounts', { code: '2320', name: 'Made-up Facility', type: 'liability', active: true });
    await owner.post('/api/sources', { name: 'Made-up facility', kind: 'bank', accountId: od.id });
    expect(await lineOf('2320')).toBe('trade_payables');
    const [logged] = await env.sql<{ n: number }[]>`select count(*)::int as n from audit_log where action = 'account_to_cash_line'`;
    expect(Number(logged!.n)).toBe(0);
    const warned = (await expectCleanAudit(env.sql)).filter((i) => i.level === 'warn').map((i) => i.text);
    expect(warned.some((t) => /^Made-up Savings Two is a bank or cash account you pay \(or paid\) from, but not on the statements' cash line\. Whether it's cash is a judgement \(money that can be drawn at short notice usually is; a deposit fixed for more than about three months usually isn't\): the cash flow statement leaves it out of cash\. Check it with your accountant before changing its line/.test(t))).toBe(true);
    expect(warned.some((t) => /^Made-up Facility is a liability you pay \(or paid\) from as a bank or cash account, but not on the statements' cash or bank overdraft line\. A bank overdraft counts as cash only when it's repayable on demand and part of day-to-day cash management/.test(t))).toBe(true);
    // Pocket's Home shows no cash figure: the audit doesn't say it does.
    expect(warned.join(' ')).not.toMatch(/Home/);
    await env.sql`delete from payment_sources where account_id in (${other.id}, ${od.id})`;
  });

  it('still points out one closed this year that held money at last year end, not one long gone', async () => {
    const owner = await login(env.app);
    const { settings } = await owner.get('/api/reference');
    const fy = financialYear(today(), settings.fyEndMonth);
    const bankAccount = await (await ref(env.sql)).acc('bank');
    const closed = async (code: string, name: string, into: string, out: string) => {
      const [acc] = await env.sql<{ id: string }[]>`insert into accounts (code, name, type, statement_line) values (${code}, ${name}, 'asset', 'other_current_assets') returning id`;
      await env.sql`insert into payment_sources (name, kind, account_id, sort, active) values (${name.toLowerCase()}, 'bank', ${acc!.id}, 98, false)`;
      await owner.post('/api/journals', { date: into, description: 'To savings (made up)', lines: [{ accountId: acc!.id, debitCents: 500_000 }, { accountId: bankAccount, creditCents: 500_000 }] });
      await owner.post('/api/journals', { date: out, description: 'Savings closed (made up)', lines: [{ accountId: bankAccount, debitCents: 500_000 }, { accountId: acc!.id, creditCents: 500_000 }] });
    };
    await closed('1085', 'Made-up Closed Savings', addDays(fy.start, -20), fy.start);
    const lastYearStart = financialYear(addDays(fy.start, -1), settings.fyEndMonth).start;
    await closed('1086', 'Made-up Long Gone', addDays(lastYearStart, -20), addDays(lastYearStart, -10));
    // Switched off, nothing in it since before last year, but money still in it: named, in the plural with the others.
    const [notice] = await env.sql<{ id: string }[]>`insert into accounts (code, name, type, statement_line) values ('1087', 'Made-up Notice Deposit', 'asset', 'other_current_assets') returning id`;
    await env.sql`insert into payment_sources (name, kind, account_id, sort, active) values ('made-up notice deposit', 'bank', ${notice!.id}, 97, false)`;
    await owner.post('/api/journals', { date: addDays(lastYearStart, -30), description: 'To notice deposit (made up)', lines: [{ accountId: notice!.id, debitCents: 800_000 }, { accountId: bankAccount, creditCents: 800_000 }] });
    const warned = (await expectCleanAudit(env.sql)).filter((i) => i.level === 'warn').map((i) => i.text).join(' ');
    expect(warned).toMatch(/Made-up Closed Savings, Made-up Notice Deposit are bank or cash accounts you pay \(or paid\) from, but not on the statements' cash line\. Whether each is cash is a judgement/);
    expect(warned).toMatch(/Check each with your accountant before changing their lines/);
    expect(warned).not.toMatch(/Made-up Long Gone/);
  });
});

// Shap 1.33's fourth round (SARS): VAT on a journal typed in isn't in the VAT201's boxes: said so.
describe('VAT on a journal typed in', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('is said beside the VAT201 and in the books audit; a payment to SARS with its interest isn’t', async () => {
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const { settings } = await owner.get('/api/reference');
    await owner.post('/api/settings', { ...settings, vatRegistered: true, vatNumber: '4000000002', vatCategory: 'C' }, 'PUT');
    const p = vatPeriod(today(), 'C', settings.fyEndMonth);
    const [fin] = await env.sql<{ id: string }[]>`insert into accounts (code, name, type, statement_line) values ('6910', 'Made-up SARS interest', 'expense', 'finance_costs') returning id`;
    await owner.post('/api/journals', { date: p.start, description: 'Made-up VAT paid, with interest', lines: [{ accountId: await r.acc('vat'), debitCents: 50_000 }, { accountId: fin!.id, debitCents: 1_000 }, { accountId: await r.acc('bank'), creditCents: 51_000 }] });
    const vat = () => owner.get<{ handVatAddedCents: number; handVatOffCents: number; handVatLines: number }>(`/api/vat/return?on=${p.start}`);
    expect(await vat()).toMatchObject({ handVatAddedCents: 0, handVatOffCents: 0, handVatLines: 0 });
    // Paid by card: a payment too.
    const [cardAcc] = await env.sql<{ id: string }[]>`insert into accounts (code, name, type) values ('2311', 'Made-up business card', 'liability') returning id`;
    await owner.post('/api/sources', { name: 'Made-up card', kind: 'card', accountId: cardAcc!.id });
    await owner.post('/api/journals', { date: p.start, description: 'Made-up VAT paid by card', lines: [{ accountId: await r.acc('vat'), debitCents: 20_000 }, { accountId: cardAcc!.id, creditCents: 20_000 }] });
    expect(await vat()).toMatchObject({ handVatLines: 0 });
    await owner.post('/api/journals', { date: p.start, description: 'Made-up cash sale', lines: [{ accountId: await r.acc('bank'), debitCents: 115_000 }, { accountId: await r.acc('revenue_other'), creditCents: 100_000 }, { accountId: await r.acc('vat'), creditCents: 15_000 }] });
    expect(await vat()).toMatchObject({ handVatAddedCents: 15_000, handVatOffCents: 0, handVatLines: 1 });
    const items = await expectCleanAudit(env.sql);
    expect(items.some((i) => i.level === 'warn' && /^journals by hand moved the VAT account in \S+ to \S+ \(R\s?150\.00 added to the VAT owed\), besides what Pocket can tell is a payment to or refund from SARS/.test(i.text))).toBe(true);
    const screen = readFileSync(join(__dirname, '..', '..', '..', 'apps', 'web', 'src', 'components', 'TaxForms.tsx'), 'utf8');
    expect(screen).toMatch(/Journals typed in added <Money cents=\{data\.handVatAddedCents \?\? 0\} \/> to the VAT owed and took <Money cents=\{data\.handVatOffCents \?\? 0\} \/> off it in this period/);
  });
});
