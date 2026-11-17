/**
 * Shap 1.31.0's IFRS review of the practitioner's compilation report, the same here
 * (statements/pdf.ts, statements/details.ts): a special purpose framework's paragraph (ISRS 4410
 * (Revised) para 40(j), Appendix 2 Illustration 2) for a sole proprietor, a partnership or a trust;
 * the directors named where the report is addressed to a company's shareholders or a co-op's members
 * (para 40(c)-(d)); the limitation sentence naming the framework the paragraph before it does. Each
 * failed on 1.11.1. All data made up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BusinessType } from '@shap/shared';
import { buildStatements } from '../src/statements/build.js';
import { renderStatementsPdf } from '../src/statements/pdf.js';
import { expectCleanAudit, login, ref, setup, type TestEnv } from './helpers.js';

const FY = '2026-02-28';
const pdfText = async (buf: Buffer) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  let out = '';
  for (let n = 1; n <= doc.numPages; n++) out += (await (await doc.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  return out.replace(/\s+/g, ' ');
};

let env: TestEnv;
let open = false;
afterEach(async () => {
  if (open) {
    await expectCleanAudit(env.sql, FY);
    await env.close();
  }
  open = false;
});

/** A year of made-up books for a business of this kind, compiled: the report's words (and note 1's). */
const reportOf = async (bt: BusinessType) => {
  env = await setup();
  open = true;
  const me = await login(env.app);
  const { settings } = await me.get('/api/reference');
  await me.post('/api/settings', { ...settings, companyName: 'Fictional Report Test', businessType: bt, fyEndMonth: 2, address: '1 Test Street, Fictional Town, 0001', features: { ...settings.features, statements: true } }, 'PUT');
  const r = await ref(env.sql);
  const sundry = (await env.sql<{ id: string }[]>`select id from accounts where type = 'expense' and system_key is null limit 1`)[0]!.id;
  const equity = bt === 'company' || bt === 'coop' ? await r.acc('share_capital') : await r.acc('owner_loan');
  await me.post('/api/journals', { date: '2025-04-01', description: 'Made-up capital', lines: [{ accountId: await r.acc('bank'), debitCents: 400_000 }, { accountId: equity, creditCents: 400_000 }] });
  await me.post('/api/journals', { date: '2025-05-01', description: 'Made-up costs', lines: [{ accountId: sundry, debitCents: 50_000 }, { accountId: await r.acc('bank'), creditCents: 50_000 }] });
  const s = await buildStatements(env.sql, FY);
  const all = await pdfText(await renderStatementsPdf({ ...s, details: { ...s.details, assurance: 'compiled' } }, { compiler: { name: 'Fictional Accountant', date: '2026-04-01', how: 'uploaded' } }));
  return { report: all.slice(all.indexOf('Practitioner’s compilation report')), all };
};

describe('the practitioner’s compilation report, as Shap 1.31 has it', () => {
  it('a sole proprietor’s: special purpose, for the owner and SARS, and may not be suitable for other purposes', async () => {
    const { report, all } = await reportOf('sole_prop');
    expect(report).toMatch(/As noted in note 1, the financial statements are prepared and presented on the basis described in note 1, for the owner and the South African Revenue Service\. Accordingly, these financial statements may not be suitable for other purposes\./);
    expect(report).toMatch(/based on information you have provided/);
    expect(all).toMatch(/recognition and measurement principles of .{0,80}for the owner and the South African Revenue Service/);
  });

  it('a partnership’s too', async () => {
    expect((await reportOf('partnership')).report).toMatch(/for the partners and the South African Revenue Service\. Accordingly, these financial statements may not be suitable for other purposes/);
  });

  it('a company’s: to its shareholders, from information the directors provided, the directors’ responsibility, the framework with its Act', async () => {
    const { report } = await reportOf('company');
    expect(report).toMatch(/based on information provided by the directors/);
    expect(report).toMatch(/to assist the directors in the preparation/);
    expect(report).toMatch(/are the directors’ responsibility/);
    expect(report).not.toMatch(/information you have provided|your responsibility|assist you|may not be suitable/);
    expect(report).toMatch(/on whether these financial statements are prepared in accordance with the IFRS for SMEs Accounting Standard.{0,40} and the requirements of the Companies Act 71 of 2008/);
  });

  it('the screens call it the compilation report', () => {
    for (const f of ['FinancialStatements.tsx', 'Welcome.tsx']) expect(readFileSync(join(import.meta.dirname, '../../../apps/web/src/pages', f), 'utf8')).not.toMatch(/compiler’s report|Compiler’s report/);
  });
});
