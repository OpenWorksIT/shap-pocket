import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, financialYear, formatDate, latePayNote, noIncomeTaxWords, vatPeriod } from '@shap/shared';
import { handVat, today } from '../src/lib/books.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

// From Shap's sixth review round of 1.33, in the code Pocket shares with it: typed-in VAT read once
// for each journal gives what reading it line by line gives, with SARS's other taxes as money (VAT
// paid with PAYE, a refund set off against it); move-in's payroll tax guesses by balance side; a
// company file can't move a used payment account past Settings' checks; a cost type on the cash
// line; a share with a journal too long for Shap; and the words. Made-up business, made-up figures.

const now = today();
const thisMonth = `${now.slice(0, 8)}01`;
type Db = TestEnv['sql'];
const web = (p: string) => readFileSync(join(__dirname, '..', '..', '..', 'apps', 'web', 'src', p), 'utf8');

/** handVat read line by line (as before Shap 1.33's rewrite), with today's money accounts. */
async function oldHandVat(db: Db, start: string, end: string) {
  const [r] = await db<{ n: number; added: string; off: string }[]>`
    with money as (
      select id from accounts where statement_line in ('cash', 'bank_overdraft') or system_key in ('owner_loan', 'paye_payable', 'uif_payable', 'sdl_payable', 'income_tax_payable', 'dwt_payable')
      union select account_id from payment_sources where kind in ('bank', 'cash', 'card', 'owner')
    )
    select count(*)::int as n, coalesce(sum(jl.credit_cents), 0)::bigint as added, coalesce(sum(jl.debit_cents), 0)::bigint as off
    from journal_lines jl join journals j on j.id = jl.journal_id join accounts a on a.id = jl.account_id
    where a.system_key = 'vat' and j.kind in ('manual', 'adjustment') and j.date between ${start}::date and ${end}::date
      and not (
        exists (select 1 from journal_lines m where m.journal_id = j.id and m.account_id in (select id from money))
        and not exists (select 1 from journal_lines o join accounts oa on oa.id = o.account_id
                        where o.journal_id = j.id and oa.type not in ('expense', 'income') and coalesce(oa.system_key, '') <> 'vat' and o.account_id not in (select id from money))
        and coalesce((select sum(o.debit_cents + o.credit_cents) from journal_lines o join accounts oa on oa.id = o.account_id
                      where o.journal_id = j.id and oa.type in ('expense', 'income') and o.account_id not in (select id from money)), 0)
            < abs(jl.credit_cents - jl.debit_cents))`;
  return { lines: r?.n ?? 0, addedCents: Number(r?.added ?? 0), offCents: Number(r?.off ?? 0) };
}

describe('handVat: the one-pass query against the old one (made-up books)', () => {
  let env: TestEnv;
  let acc: Record<'vat' | 'bank' | 'ownerLoan' | 'revenue' | 'sundry' | 'retained' | 'cos' | 'interestExp' | 'interestInc' | 'card' | 'savings' | 'dual' | 'loan' | 'cashToo' | 'paye', string>;
  let userId: string;
  const start = addDays(now, -60);
  const end = addDays(now, -31);
  beforeAll(async () => {
    env = await setup();
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const { settings } = await owner.get('/api/reference');
    await owner.post('/api/settings', { ...settings, vatRegistered: true, vatNumber: '4000000002', vatCategory: 'C' }, 'PUT');
    userId = (await env.sql<{ id: string }[]>`select id from users limit 1`)[0]!.id;
    const mk = async (code: string, name: string, type: string, line?: string) =>
      (await owner.post<{ id: string }>('/api/accounts', { code, name, type, ...(line ? { statementLine: line } : {}), active: true })).id;
    acc = {
      vat: await r.acc('vat'),
      bank: await r.acc('bank'),
      ownerLoan: await r.acc('owner_loan'),
      revenue: await r.acc('revenue_other'),
      sundry: await r.acc('sundry'),
      retained: await r.acc('retained_earnings'),
      cos: await r.acc('cos_materials'),
      interestExp: await mk('6955', 'Made-up SARS interest', 'expense', 'finance_costs'),
      interestInc: await mk('4955', 'Made-up interest received', 'income', 'finance_income'),
      card: await mk('2955', 'Made-up business card', 'liability'),
      savings: await mk('1955', 'Made-up savings', 'asset'),
      dual: await mk('1956', 'Made-up account paid from two ways', 'asset'),
      loan: await mk('2956', 'Made-up loan', 'liability', 'borrowings_current'),
      cashToo: await mk('1957', 'Made-up second current account', 'asset', 'cash'),
      paye: await r.acc('paye_payable'),
    };
    await owner.post('/api/sources', { name: 'Made-up card', kind: 'card', accountId: acc.card });
    await owner.post('/api/sources', { name: 'Made-up savings', kind: 'bank', accountId: acc.savings });
    // One account, a payment source of two kinds.
    await owner.post('/api/sources', { name: 'Made-up two-way bank', kind: 'bank', accountId: acc.dual });
    await owner.post('/api/sources', { name: 'Made-up two-way card', kind: 'card', accountId: acc.dual });
    // An account on the cash line that's also a payment source (twice, of two kinds).
    await owner.post('/api/sources', { name: 'Made-up current', kind: 'bank', accountId: acc.cashToo });
    await owner.post('/api/sources', { name: 'Made-up current till', kind: 'cash', accountId: acc.cashToo });
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  const journal = async (date: string, kind: string, lines: [string, number][]) => {
    const [j] = await env.sql<{ id: string }[]>`insert into journals (date, description, reference, kind, created_by) values (${date}, 'Made-up', '', ${kind}, ${userId}) returning id`;
    await env.sql`insert into journal_lines ${env.sql(lines.map(([a, c]) => ({ journalId: j!.id, accountId: a, debitCents: c > 0 ? c : 0, creditCents: c < 0 ? -c : 0, memo: '' })))}`;
    expect(lines.reduce((t, [, c]) => t + c, 0)).toBe(0);
  };
  const same = async (s = start, e = end) => {
    const [a, b] = [await oldHandVat(env.sql, s, e), await handVat(env.sql, s, e)];
    expect(b).toEqual(a);
    return b;
  };

  it('agrees on each kind of journal, and each gives what it should', async () => {
    const d = addDays(start, 3);
    const cases: { what: string; lines: [string, number][]; counted: { lines: number; added: number; off: number } }[] = [
      { what: 'VAT paid from the bank', lines: [[acc.vat, 100_000], [acc.bank, -100_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'several VAT lines paid at once', lines: [[acc.vat, 30_000], [acc.vat, 20_000], [acc.bank, -50_000]], counted: { lines: 0, added: 0, off: 0 } },
      // Per line: R100 interest is under the R300 line but not under the R50 one.
      { what: 'several VAT lines with SARS interest', lines: [[acc.vat, 30_000], [acc.vat, 5_000], [acc.interestExp, 10_000], [acc.bank, -45_000]], counted: { lines: 1, added: 0, off: 5_000 } },
      { what: 'VAT on both sides, against the bank', lines: [[acc.vat, 80_000], [acc.vat, -30_000], [acc.bank, -50_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'VAT on both sides, alone', lines: [[acc.vat, 40_000], [acc.vat, -40_000]], counted: { lines: 2, added: 40_000, off: 40_000 } },
      { what: 'from an account on the cash line that is two payment sources', lines: [[acc.vat, 60_000], [acc.interestExp, 1_000], [acc.cashToo, -61_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'from an account that is a payment source of two kinds', lines: [[acc.vat, 70_000], [acc.interestExp, 2_000], [acc.dual, -72_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'refund with interest', lines: [[acc.bank, 78_000], [acc.vat, -75_000], [acc.interestInc, -3_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'income and expense beside the VAT (a cash sale with a fee)', lines: [[acc.bank, 113_000], [acc.sundry, 2_000], [acc.revenue, -100_000], [acc.vat, -15_000]], counted: { lines: 1, added: 15_000, off: 0 } },
      { what: 'paid by card', lines: [[acc.vat, 9_000], [acc.card, -9_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'paid personally', lines: [[acc.vat, 8_000], [acc.ownerLoan, -8_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'paid with PAYE (SARS, sixth round)', lines: [[acc.vat, 8_000], [acc.paye, 2_000], [acc.bank, -10_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'a refund set off against PAYE (SARS, sixth round)', lines: [[acc.bank, 2_000], [acc.paye, 5_000], [acc.vat, -7_000]], counted: { lines: 0, added: 0, off: 0 } },
      { what: 'something else beside it (a loan)', lines: [[acc.vat, 7_000], [acc.bank, -3_000], [acc.loan, -4_000]], counted: { lines: 1, added: 0, off: 7_000 } },
      { what: 'cost of sales beside it (not expense or income)', lines: [[acc.vat, 6_000], [acc.cos, 100], [acc.bank, -6_100]], counted: { lines: 1, added: 0, off: 6_000 } },
      { what: 'against an expense, no money', lines: [[acc.vat, 4_000], [acc.sundry, -4_000]], counted: { lines: 1, added: 0, off: 4_000 } },
    ];
    for (const c of cases) {
      await env.sql`delete from journals where kind in ('manual', 'adjustment')`;
      await journal(d, 'manual', c.lines);
      const got = await same();
      expect({ what: c.what, lines: got.lines, added: got.addedCents, off: got.offCents }).toEqual({ what: c.what, ...c.counted });
    }
    // An adjustment counts; opening balances and imports don't; a journal outside the period doesn't.
    await env.sql`delete from journals where kind in ('manual', 'adjustment')`;
    await journal(d, 'adjustment', [[acc.vat, -1_000], [acc.retained, 1_000]]);
    await journal(d, 'opening', [[acc.vat, -2_000], [acc.retained, 2_000]]);
    await journal(d, 'import', [[acc.vat, -3_000], [acc.retained, 3_000]]);
    await journal(addDays(start, -1), 'manual', [[acc.vat, -4_000], [acc.retained, 4_000]]);
    await journal(addDays(end, 1), 'manual', [[acc.vat, -5_000], [acc.retained, 5_000]]);
    expect(await same()).toEqual({ lines: 1, addedCents: 1_000, offCents: 0 });
    await env.sql`delete from journals where kind in ('manual', 'adjustment', 'opening', 'import')`;
  });

  it('agrees on 400 made-up journals of random lines, over many periods', async () => {
    // A seeded generator: the same made-up books every run.
    let seed = 20261121;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const pool = Object.values(acc);
    const kinds = ['manual', 'manual', 'manual', 'adjustment', 'opening', 'import'];
    for (let i = 0; i < 400; i++) {
      const lines: [string, number][] = [];
      const n = 1 + Math.floor(rnd() * 5);
      // Most journals have VAT on them, some on both sides.
      if (rnd() < 0.85) lines.push([acc.vat, (rnd() < 0.5 ? 1 : -1) * (1 + Math.floor(rnd() * 100_000))]);
      if (rnd() < 0.2) lines.push([acc.vat, (rnd() < 0.5 ? 1 : -1) * (1 + Math.floor(rnd() * 100_000))]);
      for (let k = 0; k < n; k++) lines.push([pick(pool), (rnd() < 0.5 ? 1 : -1) * (1 + Math.floor(rnd() * (rnd() < 0.3 ? 2_000 : 200_000)))]);
      const t = lines.reduce((s, [, c]) => s + c, 0);
      if (t !== 0) lines.push([pick(pool.filter((a) => a !== acc.vat)), -t]);
      if (lines.length < 2) continue;
      await journal(addDays(now, -Math.floor(rnd() * 240)), pick(kinds), lines);
    }
    let counted = 0;
    for (let m = 0; m < 8; m++) {
      const p = vatPeriod(addMonths(thisMonth, -m), 'C', 2);
      counted += (await same(p.start, p.end)).lines;
    }
    await same(addDays(now, -240), now);
    await same(addDays(now, -100), addDays(now, -100));
    expect(counted).toBeGreaterThan(50);
  });
});


describe('move-in: payroll taxes by balance side and name (SARS)', () => {
  it('leaves an SDL or UIF expense (a debit) off SARS’s payable, and puts dividends tax payable on SARS’s', async () => {
    const { suggestAccount } = await import('../src/modules/movein.js');
    const acc = (systemKey: string, type: 'asset' | 'liability' | 'expense' = 'liability') => ({ id: systemKey, code: '', name: `Made-up ${systemKey}`, type, systemKey });
    const accounts = ['paye_payable', 'uif_payable', 'sdl_payable', 'wages_payable', 'payables', 'vat', 'income_tax_payable', 'dwt_payable'].map((k) => acc(k)).concat([acc('general_labour', 'expense')]);
    const guess = (name: string, cents: number) => suggestAccount({ code: '', name, cents } as never, accounts);
    expect(guess('Skills development levy', 1_200_000)).not.toBe('sdl_payable');
    expect(guess('UIF company contributions', 600_000)).not.toBe('uif_payable');
    expect(guess('SDL payable', -100_000)).toBe('sdl_payable');
    expect(guess('Employee tax payable', -500_000)).toBe('paye_payable');
    expect(guess('Dividends tax payable', -200_000)).toBe('dwt_payable');
  });
});

describe('moving a used payment account or cost type (IFRS, accounting, words)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('names last year’s figures only when there are some, refuses a cost type on the cash line too, and a company file alike', async () => {
    const owner = await login(env.app);
    const r = await ref(env.sql);
    const bank = await r.src('Business bank');
    const { settings } = await owner.get('/api/reference');
    const fy = financialYear(now, settings.fyEndMonth);
    await owner.post('/api/costs', { date: now, description: 'Made-up fuel', supplier: 'Made-up Garage', amountCents: 50_000, categoryId: await r.cat('Petrol'), sourceId: bank });
    const hold = await owner.post<{ id: string }>('/api/accounts', { code: '1079', name: 'Made-up Holding', type: 'asset', active: true });
    const put = (path: string, id: string, body: unknown) => owner.call({ method: 'PUT', url: `/api/${path}/${id}`, payload: body as never });
    const refused = await put('sources', bank, { name: 'Business bank', kind: 'bank', accountId: hold.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).not.toMatch(/cash line with it, last year’s figures too/);
    // A cost type on Cash on hand, moved to Sundry: refused too.
    const [petty] = await env.sql<{ id: string }[]>`select id from accounts where code = '1050'`;
    const cat = await owner.post<{ id: string }>('/api/categories', { name: 'Made-up petty cash top-up', kind: 'overhead', accountId: petty!.id });
    await owner.post('/api/costs', { date: addDays(now, -2), description: 'Made-up top-up', supplier: '', amountCents: 20_000, categoryId: cat.id, sourceId: bank });
    const moved = await put('categories', cat.id, { name: 'Made-up petty cash top-up', kind: 'overhead', accountId: await r.acc('sundry') });
    expect(moved.statusCode).toBe(400);
    expect(moved.json().error).toMatch(/otherwise add a new one under Cost types for what’s coming\.$/);
    // From a company file: refused the same way, and a closed year's history isn't moved.
    const file = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', sources: [{ name: 'Business bank', kind: 'bank', account: '1079' }] } } });
    expect(file.statusCode).toBe(400);
    expect(file.json().error).toMatch(/^The company file puts “Business bank” \(Paid from \/ into\) on another account\. What’s already captured with this would move on or off the statements’ cash line with it\. Change the file \(give it a new name there, or leave it out\) and load it again\. Or, if the new account has nothing in it yet, put it on the same line in the file, after checking with your accountant\.$/);
    const till = await owner.post<{ id: string }>('/api/sources', { name: 'Made-up till', kind: 'cash', accountId: await r.acc('bank') });
    await owner.post('/api/costs', { date: addDays(fy.start, -30), description: 'Made-up fuel last year', supplier: 'Made-up Garage', amountCents: 20_000, categoryId: await r.cat('Petrol'), sourceId: till.id });
    await env.sql`update settings set lock_date = ${addDays(fy.start, -1)}::date where id`;
    const closed = await owner.call({ method: 'POST', url: '/api/company-file', payload: { file: { format: 'shap-company/1', sources: [{ name: 'Made-up till', kind: 'cash', account: '1079' }] } } });
    expect(closed.statusCode).toBe(400);
    const [on] = await env.sql<{ code: string }[]>`select a.code from payment_sources s join accounts a on a.id = s.account_id where s.id = ${till.id}`;
    expect(on!.code).toBe('1000');
    await env.sql`update settings set lock_date = null where id`;
  });
});

describe('a share with a journal longer than Shap takes (security)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => {
    await expectCleanAudit(env.sql);
    await env.close();
  });

  it('is said plainly on the phone, not offered', async () => {
    const owner = await login(env.app);
    const r = await ref(env.sql);
    // A journal of 1 200 lines, as Pocket took before 1.11.4's cap.
    const [u] = await env.sql<{ id: string }[]>`select id from users limit 1`;
    const [j] = await env.sql<{ id: string }[]>`insert into journals (date, description, reference, kind, created_by) values (${now}, 'Made-up long journal', '', 'manual', ${u!.id}) returning id`;
    await env.sql`insert into journal_lines (journal_id, account_id, debit_cents, credit_cents, memo)
      select ${j!.id}::uuid, ${await r.acc('revenue_other')}::uuid, 0, 1, '' from generate_series(1, 1199)
      union all select ${j!.id}::uuid, ${await r.acc('bank')}::uuid, 1199, 0, ''`;
    const res = await owner.call({ method: 'POST', url: '/api/share' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(`A journal in your books (${formatDate(now)}, “Made-up long journal”) has more than 1 000 lines, more than your accountant’s Shap takes: split it into journals that each balance, then share again.`);
  });
});

describe('the sixth round’s words', () => {
  it('net profit’s words, the late pay note, the audit log and the VAT201 note', () => {
    expect(noIncomeTaxWords({ businessType: 'company' })).toBe('; before income tax (none captured in the books)');
    expect(noIncomeTaxWords({ businessType: 'sole_prop' })).toBe('; your income tax is your own, not the business’s');
    expect(latePayNote('2027-02', '2027-03-05')).toMatch(/^The pay date is in the next tax year \(from 1 March 2027\)\./);
    const log = web('components/AuditLog.tsx');
    for (const key of ["account: 'Account'", "payment_source: 'Paid from / into'", "cost_category: 'Cost type'", "account_line_changed: 'line or type changed'", "moved_to_account: 'moved onto another account'"]) expect(log).toContain(`  ${key}`);
    expect(log).toMatch(/bits\.push\(`from \$\{accountWords\(d\.from\)\} to \$\{accountWords\(d\.to\)\}\$\{movedWords\(d\.moved\)\}\$\{typeof d\.by === 'string' \? ` · by \$\{d\.by\}` : ''\}`\)/);
    const screen = web('components/TaxForms.tsx');
    expect(screen).not.toMatch(/Journals typed in added <Money cents=\{data\.handVatAddedCents \?\? 0\} \/> to the VAT owed and took/);
    expect(screen).toMatch(/\(data\.handVatAddedCents \?\? 0\) > 0 \? \(/);
  });
});
