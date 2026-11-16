-- Share with your accountant (modules/share.ts): each share made, stamped with its number and when,
-- and the mark of every transaction in it, so the next one says what changed since the last one
-- sent. A share is pending until the phone's share sheet says it went (sent_at).
create table if not exists shares (
  number int primary key check (number > 0),
  made_at timestamptz not null default now(),
  through date not null,
  -- Each transaction's key and a hash of what it posted.
  marks jsonb not null default '{}',
  made_by uuid references users(id),
  -- The file itself, until it's sent (or a newer one is made).
  file jsonb,
  sent_at timestamptz
);
