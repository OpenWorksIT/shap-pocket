import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, financialYear, shareProblem, type PocketShare } from '@shap/shared';
import { today } from '../src/lib/books.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

// From Shap's seventh review round of 1.33, in the code Pocket shares with it: a company file
// without lines keeps each account on its line, and turnover tax to the kinds of business that
// have it; a move logs how much of each year moved, and an unused payment account isn't held up by
// another's closed year; a share's journal counted however its id is written; move-in's UIF owed
// by name; and import VAT said under the VAT201. Made-up business, made-up figures.

const now = today();
const web = (p: string) => readFileSync(join(__dirname, '..', '..', '..', 'apps', 'web', 'src', p), 'utf8');

describe('a company file and moving accounts (IFRS, accounting)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('keeps every account on its line when the file gives none, and turnover tax off for a trust', async () => {
    const owner = await login(env.app);
    const before = await env.sql<{ code: string; name: string; type: string; line: string }[]>`select code, name, type, statement_line as line from accounts order by code`;
    const res = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', accounts: before.map((a) => ({ code: a.code, name: a.name, type: a.type })) } } });
    expect(res.statusCode).toBe(200);
    const after = await env.sql<{ code: string; line: string }[]>`select code, statement_line as line from accounts order by code`;
    expect(before.filter((b) => after.find((a) => a.code === b.code)!.line !== b.line).map((b) => b.code)).toEqual([]);
    expect((await env.sql`select 1 from audit_log where action = 'account_line_changed'`).length).toBe(0);
  });

  it('logs how much of each year moved, and lets an unused payment account move though the bank has a closed year', async () => {
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const bank = await r.src('Business bank');
    const { settings } = await owner.get('/api/reference');
    const fy = financialYear(now, settings.fyEndMonth);
    const petrol = await r.cat('Petrol');
    await owner.post('/api/costs', { date: addDays(fy.start, -20), description: 'Made-up fuel last year', supplier: 'Made-up Garage', amountCents: 30_000, categoryId: petrol, sourceId: bank });
    await owner.post('/api/costs', { date: now, description: 'Made-up fuel', supplier: 'Made-up Garage', amountCents: 50_000, categoryId: petrol, sourceId: bank });
    const prepaid = await owner.post<{ id: string }>('/api/accounts', { code: '1450', name: 'Made-up Prepaid', type: 'asset', statementLine: 'other_current_assets', active: true });
    const cat = (await env.sql<{ name: string; kind: string }[]>`select name, kind from cost_categories where id = ${petrol}`)[0]!;
    expect((await owner.call({ method: 'PUT', url: `/api/categories/${petrol}`, payload: { name: cat.name, kind: cat.kind, accountId: prepaid.id } })).statusCode).toBe(200);
    const [log] = await env.sql<{ details: Record<string, unknown> }[]>`select details from audit_log where action = 'moved_to_account'`;
    expect(log!.details.moved).toEqual({ thisYearCents: 50_000, lastYearCents: 30_000, earlierCents: 0 });
    // The bank has last year's cost in a closed year; a spare source on it, never used, still moves.
    await env.sql`update settings set lock_date = ${addDays(fy.start, -1)}::date where id`;
    const second = await owner.post<{ id: string }>('/api/accounts', { code: '1003', name: 'Made-up Second Bank', type: 'asset', statementLine: 'cash', active: true });
    const spare = await owner.post<{ id: string }>('/api/sources', { name: 'Made-up spare', kind: 'bank', accountId: await r.acc('bank') });
    expect((await owner.call({ method: 'PUT', url: `/api/sources/${spare.id}`, payload: { name: 'Made-up spare', kind: 'bank', accountId: second.id } })).statusCode).toBe(200);
    // The bank itself, with its closed year: refused.
    expect((await owner.call({ method: 'PUT', url: `/api/sources/${bank}`, payload: { name: 'Business bank', kind: 'bank', accountId: second.id } })).statusCode).toBe(400);
    await env.sql`update settings set lock_date = null where id`;
  });
});

describe('a share’s journal, however its id is written (security)', () => {
  it('is counted as one journal', () => {
    const id = '4a6c8e0b-2d4f-4a6b-8c0d-1e2f3a4b5c6d';
    const spellings = [id, id.toUpperCase(), `{${id}}`, id.replace(/-/g, '')];
    const lines = spellings.flatMap((s) => Array.from({ length: 300 }, () => ({ journal_id: s, debit_cents: 1, credit_cents: 0 })));
    const share = { records: { settings: [{}], journal_lines: lines }, entries: [] } as unknown as PocketShare;
    expect(shareProblem(share)).toEqual({ kind: 'long_journal', table: 'journal_lines' });
  });
});

describe('move-in and the VAT201 (SARS)', () => {
  it('takes UIF named as owed as SARS’s, whatever else its name says, and the expense not', async () => {
    const { suggestAccount } = await import('../src/modules/movein.js');
    const acc = (systemKey: string, type: 'asset' | 'liability' | 'expense' = 'liability') => ({ id: systemKey, code: '', name: `Made-up ${systemKey}`, type, systemKey });
    const accounts = ['paye_payable', 'uif_payable', 'sdl_payable', 'wages_payable', 'payables', 'vat', 'income_tax_payable', 'dwt_payable'].map((k) => acc(k)).concat([acc('general_labour', 'expense')]);
    const guess = (name: string, cents: number) => suggestAccount({ code: '', name, cents } as never, accounts);
    expect(guess('Employer UIF payable', -120_000)).toBe('uif_payable');
    expect(guess('UIF contributions payable', -250_000)).toBe('uif_payable');
    expect(guess('UIF company contributions', 600_000)).not.toBe('uif_payable');
    expect(guess('Dividends withholding tax payable', -300_000)).toBe('dwt_payable');
  });

  it('says under the boxes that import VAT journalled against the bank isn’t in them', () => {
    const screen = web('components/TaxForms.tsx');
    const note = screen.slice(screen.indexOf('{data.handVatLines ? ('), screen.indexOf('<section className="panel">', screen.indexOf('{data.handVatLines ? (')));
    expect(screen.replace(note, '')).toMatch(/Import VAT journalled against the bank looks like a payment to SARS, so it isn’t in the boxes or counted with journals typed in: as input tax it goes in field 14A or 15A, which Shap Pocket doesn’t fill, for you or your accountant to add\./);
  });
});
