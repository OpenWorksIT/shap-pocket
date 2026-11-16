/**
 * Share with your accountant (Shap's docs/ACCOUNTANT.md, "A Shap Pocket share"): the whole of the books as one file the owner sends
 * their accountant, who brings it into Shap (Shap Accountant: a read-only copy of these books in the
 * practice's Shap). Each share is stamped (its number and when it was made), and says what changed
 * since the last one sent, so the accountant sees what's new without comparing.
 *
 * What's in it: the business's details Shap needs to read the books (its name, kind, year end, VAT
 * registration and category, turnover tax), the chart of accounts, and every posting in the books,
 * by transaction, with its date, reference and description (which can name the business's own
 * customers and suppliers). Nothing else: no documents' PDFs, no slips, no people's ID numbers or
 * pay details beyond the postings. It goes only where the owner sends it, from the phone's share
 * sheet: nothing is sent from here.
 *
 * Making one keeps it pending; it counts as sent when the share sheet says it went (POST …/sent),
 * so a share that was cancelled doesn't move the "changed since" mark.
 */
import type { App as FastifyInstance } from '../http.js';
import { sha256Hex } from '@shap/shared';
import { z } from 'zod';
import { requireRole, userOrThrow } from '../auth.js';
import type { Ctx } from '../context.js';
import type { Db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { freshTotals, getSettings, today } from '../lib/books.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

export const SHARE_FORMAT = 'shap-pocket-share/1';

export interface ShareTransaction {
  /** The same transaction in every share: what it came from and its id. */
  key: string;
  date: string;
  source: string;
  reference: string;
  description: string;
  /** Debit positive, by account code. */
  lines: { code: string; cents: number; memo: string }[];
}

export interface ShareFile {
  format: typeof SHARE_FORMAT;
  stamp: { number: number; madeAt: string; through: string; previous: { number: number; madeAt: string } | null; app: 'Shap Pocket' };
  business: { companyName: string; tradingName: string; businessType: string; fyEndMonth: number; vatRegistered: boolean; vatCategory: string; vatNumber: string; turnoverTax: boolean; approvedPbo: boolean };
  accounts: { code: string; name: string; type: string }[];
  transactions: ShareTransaction[];
  /** Since the previous share sent: transactions by key. */
  changes: { added: string[]; changed: string[]; removed: string[] };
  totals: { transactions: number; debitsCents: number };
}

const hashOf = (t: ShareTransaction) => sha256Hex(JSON.stringify([t.date, t.reference, t.description, t.lines.map((l) => [l.code, l.cents, l.memo])]));

/** Every posting in the books to `through`, by transaction. */
export async function shareTransactions(db: Db, through: string): Promise<ShareTransaction[]> {
  await freshTotals(db);
  const rows = await db<{ date: string; source: string; sourceId: string | null; memo: string; amountCents: number; code: string; docNumber: string | null }[]>`
    select l.date::text as date, l.source, l.source_id::text as source_id, coalesce(l.memo, '') as memo, l.amount_cents, a.code, coalesce(d.number, rd.number) as doc_number
    from ledger l join accounts a on a.id = l.account_id
    left join documents d on d.id = l.source_id and l.source in ('invoice', 'credit_note', 'write_off')
    left join receipts r on r.id = l.source_id and l.source = 'receipt'
    left join documents rd on rd.id = r.invoice_id
    where l.date <= ${through}::date and l.amount_cents <> 0
    order by l.date, l.source, l.source_id, a.code`;
  const by = new Map<string, ShareTransaction>();
  for (const r of rows) {
    // One transaction per thing posted (and per day, for what posts on more than one day).
    const key = `${r.source}:${r.sourceId ?? 'none'}:${r.date}`;
    let t = by.get(key);
    if (!t) {
      t = { key, date: r.date, source: r.source, reference: r.docNumber ?? '', description: r.memo, lines: [] };
      by.set(key, t);
    }
    const same = t.lines.find((l) => l.code === r.code && l.memo === r.memo);
    if (same) same.cents += Number(r.amountCents);
    else t.lines.push({ code: r.code, cents: Number(r.amountCents), memo: r.memo });
  }
  return [...by.values()].map((t) => ({ ...t, lines: t.lines.filter((l) => l.cents !== 0) })).filter((t) => t.lines.length > 0);
}

/** Builds the next share (pending until it's sent). */
export async function makeShare(db: Db, userId: string | null): Promise<ShareFile> {
  const s = await getSettings(db);
  const through = today();
  const transactions = await shareTransactions(db, through);
  const off = transactions.reduce((sum, t) => sum + t.lines.reduce((x, l) => x + l.cents, 0), 0);
  if (off !== 0) throw badRequest('The books don’t balance, so they can’t be shared yet: Settings → Checks says where.');
  const [last] = await db<{ number: number; madeAt: Date; marks: Record<string, string> }[]>`select number, made_at, marks from shares where sent_at is not null order by number desc limit 1`;
  const [top] = await db<{ n: number | null }[]>`select max(number)::int as n from shares`;
  const number = (top?.n ?? 0) + 1;
  const marks = Object.fromEntries(transactions.map((t) => [t.key, hashOf(t)]));
  const before = last?.marks ?? {};
  const changes = {
    added: last ? Object.keys(marks).filter((k) => !(k in before)) : [],
    changed: Object.keys(marks).filter((k) => k in before && before[k] !== marks[k]),
    removed: Object.keys(before).filter((k) => !(k in marks)),
  };
  const madeAt = new Date();
  const accounts = await db<{ code: string; name: string; type: string }[]>`select code, name, type from accounts order by code`;
  const file: ShareFile = {
    format: SHARE_FORMAT,
    stamp: { number, madeAt: madeAt.toISOString(), through, previous: last ? { number: last.number, madeAt: new Date(last.madeAt).toISOString() } : null, app: 'Shap Pocket' },
    business: {
      companyName: s.companyName,
      tradingName: s.tradingName ?? '',
      businessType: s.businessType,
      fyEndMonth: s.fyEndMonth,
      vatRegistered: s.vatRegistered,
      vatCategory: s.vatCategory,
      vatNumber: s.vatNumber ?? '',
      turnoverTax: s.turnoverTax,
      approvedPbo: Boolean(s.approvedPbo),
    },
    accounts,
    transactions,
    changes,
    totals: { transactions: transactions.length, debitsCents: transactions.reduce((sum, t) => sum + t.lines.reduce((x, l) => x + Math.max(l.cents, 0), 0), 0) },
  };
  // One pending at a time: an older one that never went is dropped.
  await db`delete from shares where sent_at is null`;
  await db`insert into shares (number, made_at, through, marks, made_by, file) values (${number}, ${madeAt}, ${through}::date, ${db.json(marks as never)}, ${userId}, ${db.json(file as never)})`;
  return file;
}

export function registerShareRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { sql } = ctx;
  const owner = { preHandler: requireRole('owner') };

  /** Where the shares stand: the last one sent, and what's changed in the books since. */
  app.get('/api/share', owner, async () => {
    const [last] = await sql<{ number: number; madeAt: Date; sentAt: Date; marks: Record<string, string> }[]>`select number, made_at, sent_at, marks from shares where sent_at is not null order by number desc limit 1`;
    if (!last) return { last: null, changedSince: null };
    const now = Object.fromEntries((await shareTransactions(sql, today())).map((t) => [t.key, hashOf(t)]));
    const before = last.marks ?? {};
    const changedSince = Object.keys(now).filter((k) => before[k] !== now[k]).length + Object.keys(before).filter((k) => !(k in now)).length;
    return { last: { number: last.number, madeAt: last.madeAt, sentAt: last.sentAt }, changedSince };
  });

  /** Make the next share (then fetch its file for the share sheet). */
  app.post('/api/share', owner, async (req) => {
    const user = userOrThrow(req);
    const file = await sql.begin((tx) => makeShare(tx, user.id));
    await audit(sql, { userId: user.id, action: 'make_share', entity: 'share', entityId: String(file.stamp.number), ip: req.ip, details: { transactions: file.totals.transactions } });
    return { number: file.stamp.number, through: file.stamp.through, transactions: file.totals.transactions, changes: { added: file.changes.added.length, changed: file.changes.changed.length, removed: file.changes.removed.length }, previous: file.stamp.previous };
  });

  /** A share's file, while it hasn't gone. */
  app.get('/api/share/:number/file', owner, async (req, reply) => {
    const { number } = parse(z.object({ number: z.coerce.number().int().positive() }), req.params);
    const [r] = await sql<{ file: ShareFile | null }[]>`select file from shares where number = ${number}`;
    if (!r?.file) throw notFound('Share');
    const name = `${r.file.business.companyName.replace(/[^\w .-]+/g, '').trim() || 'Books'} share ${number} ${r.file.stamp.through}.json`;
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(JSON.stringify(r.file));
  });

  /** The share sheet said it went: the next share's "changed since" counts from this one. */
  app.post('/api/share/:number/sent', owner, async (req) => {
    const user = userOrThrow(req);
    const { number } = parse(z.object({ number: z.coerce.number().int().positive() }), req.params);
    // Sent: its marks stay (the next share compares with them), its file goes.
    const [r] = await sql<{ number: number }[]>`update shares set sent_at = coalesce(sent_at, now()), file = null where number = ${number} returning number`;
    if (!r) throw notFound('Share');
    await audit(sql, { userId: user.id, action: 'share_sent', entity: 'share', entityId: String(number), ip: req.ip });
    return { ok: true };
  });
}
