import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths, termsPoints } from '@shap/shared';
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
