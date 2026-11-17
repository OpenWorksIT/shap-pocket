/**
 * Share with your accountant (Shap's docs/ACCOUNTANT.md, "A Shap Pocket share"): the books as one
 * file the owner sends their accountant, who brings it into the practice's Shap (Shap Accountant:
 * the practice's copy of these books, to compile their statements). Each share is stamped (its
 * number, when it was made, and these books' own id) and says what changed since the last one sent.
 *
 * What's in it (packages/shared pocket-share.ts, SHARE_TABLES): the books' own records (invoices,
 * costs, assets, pay runs, journals and the rest, which name the business's customers, suppliers,
 * workers, employees and shareholders and what they were paid), the chart of accounts and the
 * business's details. Left out: who signs in, photos of slips, people's ID, tax and bank numbers,
 * and contact details. It goes only where the owner sends it, from the phone's share sheet: nothing
 * is sent from here.
 *
 * Making one keeps it pending; it counts as shared once the share sheet says where it went (POST
 * …/sent), so one that was cancelled doesn't move the "changed since" mark.
 */
import type { App as FastifyInstance } from '../http.js';
import { entryHash, figuresHash, POCKET_SHARE_FORMAT, pocketShareSchema, SHARE_TABLES, SHARE_USER_COLUMNS, shareDiff, shareEntries, type PocketShare } from '@shap/shared';
import { z } from 'zod';
import { requireRole, userOrThrow } from '../auth.js';
import type { Ctx } from '../context.js';
import type { Db } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { freshTotals, today } from '../lib/books.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

/** The format, the same schema in Shap and here (packages/shared pocket-share.ts). */
export const SHARE_FORMAT = POCKET_SHARE_FORMAT;
export type ShareFile = PocketShare;

declare const __SHAP_VERSION__: string | undefined;
const VERSION = typeof __SHAP_VERSION__ === 'string' ? __SHAP_VERSION__ : '';

/** The books' entries don't add up (the database checks each journal, so this would be a fault). */
export const BOOKS_DONT_BALANCE = 'Your books don’t balance, so they can’t be shared (Settings → Checks & audit log shows by how much). That shouldn’t happen: please let us know: tap Feedback, then Bug found.';

const query = (db: Db) => db as unknown as Parameters<typeof shareEntries>[0];

/** Each entry in the books to `through`: key → its hash (what "changed since" compares). */
export async function shareMarks(db: Db, through: string) {
  await freshTotals(db);
  const entries = await shareEntries(query(db), through);
  return { entries, marks: Object.fromEntries(entries.map((e) => [e.key, entryHash(e)])) as Record<string, string> };
}

/**
 * The books' records, as the database has them (read as JSON text, so no column name is changed on
 * the way), with what never leaves the phone taken out.
 */
export async function shareRecords(db: Db): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of SHARE_TABLES) {
    const rows = await db.unsafe<{ j: string }[]>(`select row_to_json(t)::text as j from ${t.table} t`);
    out[t.table] = rows.map((r) => {
      const row = JSON.parse(r.j) as Record<string, unknown>;
      for (const c of t.leaveOut ?? []) delete row[c];
      for (const c of SHARE_USER_COLUMNS) if (c in row) row[c] = null;
      return row;
    });
  }
  return out;
}

/** The marks of the last share sent (stored as text: the database layer leaves its keys alone). */
async function lastSent(db: Db) {
  const [last] = await db<{ number: number; madeAt: Date; marks: string }[]>`select number, made_at, marks::text as marks from shares where sent_at is not null order by number desc limit 1`;
  return last ? { number: last.number, madeAt: new Date(last.madeAt), marks: JSON.parse(last.marks || '{}') as Record<string, string> } : null;
}

/** Builds the next share (pending until it's sent), checked against the format Shap reads. */
export async function makeShare(db: Db, userId: string | null): Promise<ShareFile> {
  const through = today();
  const { entries, marks } = await shareMarks(db, through);
  const off = entries.reduce((sum, t) => sum + t.lines.reduce((x, l) => x + l.cents, 0), 0);
  if (off !== 0) throw badRequest(BOOKS_DONT_BALANCE);
  const last = await lastSent(db);
  const [top] = await db<{ n: number | null }[]>`select max(number)::int as n from shares`;
  const number = (top?.n ?? 0) + 1;
  const [s] = await db<{ booksId: string }[]>`select books_id from settings where id`;
  const diff = last ? shareDiff(last.marks, marks) : { added: [], changed: [], removed: [] };
  const madeAt = new Date();
  const file = {
    format: SHARE_FORMAT,
    stamp: { number, madeAt: madeAt.toISOString(), through, previous: last ? { number: last.number, madeAt: last.madeAt.toISOString() } : null, app: 'Shap Pocket' as const, books: s!.booksId, version: VERSION },
    records: await shareRecords(db),
    entries: entries.map((e) => ({ key: e.key, hash: marks[e.key]!, figures: figuresHash(e) })),
    changes: { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length },
  };
  // What Shap reads: the same schema. A file it would refuse is never offered.
  const checked = pocketShareSchema.safeParse(file);
  if (!checked.success) throw new HttpError(500, 'Shap Pocket couldn’t make a share your accountant’s Shap can read. That shouldn’t happen: please let us know: tap Feedback, then Bug found.', 'internal');
  // One pending at a time: an older one that never went is dropped.
  await db`delete from shares where sent_at is null`;
  await db`insert into shares (number, made_at, through, marks, made_by, file) values (${number}, ${madeAt}, ${through}::date, ${JSON.stringify(marks)}, ${userId}, ${JSON.stringify(file)})`;
  return file;
}

export function registerShareRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { sql } = ctx;
  const owner = { preHandler: requireRole('owner') };

  /** Where the shares stand: the last one shared, and what's changed in the books since. */
  app.get('/api/share', owner, async () => {
    const [sent] = await sql<{ sentAt: Date }[]>`select sent_at from shares where sent_at is not null order by number desc limit 1`;
    const last = await lastSent(sql);
    if (!last) return { last: null, changedSince: null };
    const { marks } = await shareMarks(sql, today());
    const d = shareDiff(last.marks, marks);
    return { last: { number: last.number, madeAt: last.madeAt, sentAt: sent!.sentAt }, changedSince: d.added.length + d.changed.length + d.removed.length };
  });

  /** Make the next share (then fetch its file for the share sheet). */
  app.post('/api/share', owner, async (req) => {
    const user = userOrThrow(req);
    const file = await sql.begin((tx) => makeShare(tx, user.id));
    await audit(sql, { userId: user.id, action: 'make_share', entity: 'share', entityId: String(file.stamp.number), ip: req.ip, details: { entries: file.entries.length } });
    return { number: file.stamp.number, through: file.stamp.through, entries: file.entries.length, changes: file.changes, previous: file.stamp.previous };
  });

  /** A share's file, while it hasn't gone. */
  app.get('/api/share/:number/file', owner, async (req, reply) => {
    const { number } = parse(z.object({ number: z.coerce.number().int().positive() }), req.params);
    const [r] = await sql<{ file: string | null; through: string }[]>`select file::text as file, through::text as through from shares where number = ${number}`;
    if (!r?.file) throw notFound('Share');
    const [s] = await sql<{ companyName: string }[]>`select company_name from settings where id`;
    const name = `${(s?.companyName ?? '').replace(/[^\w .-]+/g, '').trim() || 'Books'} share ${number} ${r.through}.json`;
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(r.file);
  });

  /** The share sheet said where it went: the next share's "changed since" counts from this one. */
  app.post('/api/share/:number/sent', owner, async (req) => {
    const user = userOrThrow(req);
    const { number } = parse(z.object({ number: z.coerce.number().int().positive() }), req.params);
    // Shared: its marks stay (the next share compares with them), its file goes.
    const [r] = await sql<{ number: number }[]>`update shares set sent_at = coalesce(sent_at, now()), file = null where number = ${number} returning number`;
    if (!r) throw notFound('Share');
    await audit(sql, { userId: user.id, action: 'share_sent', entity: 'share', entityId: String(number), ip: req.ip });
    return { ok: true };
  });
}
