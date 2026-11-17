/**
 * From the IFRS for SMEs reviews of Shap 1.27.0 and 1.28.0, in the statements code Shap Pocket shares:
 * depreciation posted by journal moves no cash, so the statement of cash flows adds it back
 * (IFRS for SMEs 7.8) rather than showing it as an asset sold; and the statements aren't compiled
 * until whoever approves them is named (Companies Act s30(3)(c)). All data made up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildStatements } from '../src/statements/build.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

const FY = '2026-02-28';

describe('depreciation by journal, in the statement of cash flows', () => {
  let env: TestEnv;
  let me: Awaited<ReturnType<typeof login>>;
  let r: Awaited<ReturnType<typeof ref>>;

  beforeAll(async () => {
    env = await setup();
    me = await login(env.app);
    r = await ref(env.sql);
    // Tools bought from the bank by journal, then written down by hand at the year end.
    await me.post('/api/journals', { date: '2025-04-01', description: 'Shares issued (made up)', lines: [{ accountId: await r.acc('bank'), debitCents: 3_000_000 }, { accountId: await r.acc('share_capital'), creditCents: 3_000_000 }] });
    await me.post('/api/journals', { date: '2025-05-01', description: 'Made-up compressor', lines: [{ accountId: await r.acc('fixed_assets'), debitCents: 2_000_000 }, { accountId: await r.acc('bank'), creditCents: 2_000_000 }] });
  });
  afterAll(async () => env.close());

  it('adds a hand journal’s depreciation back, and shows the purchase in full', async () => {
    await me.post('/api/journals', { date: FY, description: 'Made-up depreciation for the year', lines: [{ accountId: await r.acc('depreciation'), debitCents: 500_000 }, { accountId: await r.acc('accumulated_depreciation'), creditCents: 500_000 }] });
    const s = await buildStatements(env.sql, FY);
    expect(s.scf.investing.find((l) => l.key === 'ppe')?.current).toBe(-2_000_000);
    expect(s.scf.operating.find((l) => l.key === 'depreciation')?.current).toBe(500_000);
    expect(s.scf.closing.current).toBe(1_000_000);
    await expectCleanAudit(env.sql, FY);
  });
});

describe('who approves the statements is named (from Shap 1.27’s IFRS review)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(async () => env.close());

  it('stops compiling until the owner who approves them is named', async () => {
    const { loadDetails } = await import('../src/statements/details.js');
    const details = await loadDetails(env.sql);
    const none = await buildStatements(env.sql, FY, { ...details, directors: [] });
    const c = none.checks.find((x) => /who approves? the statements (is|are) named/.test(x.label));
    expect(c?.ok).toBe(false);
    expect(c?.level).not.toBe('look');
    expect(c?.detail).toMatch(/none named/);
    const named = await buildStatements(env.sql, FY, { ...details, directors: [{ name: 'Made-up Owner', role: '' }] });
    expect(named.checks.find((x) => x.label === c!.label)?.ok).toBe(true);
    await expectCleanAudit(env.sql, FY);
  });
});
