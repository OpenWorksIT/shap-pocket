-- Share with your accountant (modules/share.ts): each share made, stamped with its number and when,
-- and the mark of every entry in it, so the next one says what changed since the last one shared.
-- A share is pending until the phone's share sheet says where it went (sent_at).
create table if not exists shares (
  number int primary key check (number > 0),
  made_at timestamptz not null default now(),
  through date not null,
  -- Each entry's key and a hash of it, as JSON text (kept as written: shared pocket-share.ts).
  marks text not null default '{}',
  made_by uuid references users(id),
  -- The file itself, until it's shared (or a newer one is made).
  file text,
  sent_at timestamptz
);
-- These books, once and for all: each share says which books it's of, so the accountant's Shap
-- never takes another business's share for these.
alter table settings add column if not exists books_id uuid not null default gen_random_uuid();
