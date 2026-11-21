import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, termsPoints } from '@shap/shared';
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
    // Interest paid: a finance cost, apart from running costs.
    await owner.post('/api/costs', { date: day, description: 'Made-up interest', supplier: 'Made-up Bank', amountCents: 20_000, categoryId: await r.cat('Interest'), sourceId: bank });
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
    expect(y.grossProfitCents + y.otherIncomeCents - y.runningCostsCents - y.financeCostsCents - y.incomeTaxCents).toBe(y.profitCents);
    const home = readFileSync(join(__dirname, '..', '..', '..', 'apps', 'web', 'src', 'pages', 'Home.tsx'), 'utf8');
    expect(home).toMatch(/`Revenue \$\{data\.financialYear\.label\} to date`/);
    expect(home).toMatch(/of revenue, as the financial statements count it`/);
  });
});

describe('a pay date a year off, and a new bank account', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('refuses a pay date a year off its month', async () => {
    const owner = await login(env.app);
    const bank = await (await ref(env.sql)).src('Business bank');
    const { settings: s } = await owner.get('/api/reference');
    await owner.post('/api/settings', { ...s, features: { ...s.features, payroll: true } }, 'PUT');
    const r = await owner.call({ method: 'POST', url: '/api/pay-runs', payload: { period: '2026-11', payDate: '2025-11-25', sourceId: bank } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/looks like a slip of the year/);
  });

  it('puts a new, empty bank account behind a payment source on the cash line, logged', async () => {
    const owner = await login(env.app);
    const acc = await owner.post<{ id: string }>('/api/accounts', { code: '1070', name: 'Made-up Savings', type: 'asset', active: true });
    await owner.post('/api/sources', { name: 'Made-up savings', kind: 'bank', accountId: acc.id });
    const [line] = await env.sql<{ statementLine: string }[]>`select statement_line from accounts where id = ${acc.id}`;
    expect(line!.statementLine).toBe('cash');
    const [old] = await env.sql<{ id: string }[]>`insert into accounts (code, name, type, statement_line) values ('1080', 'Made-up Old Savings', 'asset', 'other_current_assets') returning id`;
    await env.sql`insert into payment_sources (name, kind, account_id, sort) values ('Made-up old savings', 'bank', ${old!.id}, 99)`;
    const items = await expectCleanAudit(env.sql);
    expect(items.some((i) => i.level === 'warn' && /Made-up Old Savings is a bank or cash account you pay from/.test(i.text))).toBe(true);
    await env.sql`delete from payment_sources where account_id = ${old!.id}`;
  });
});
