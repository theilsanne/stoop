-- Stamps: "I really like this one". Each of you stamps the listings you love, with your picture.
-- Separate from verdicts and scoring: a stamp never changes a score.
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
-- Run after 20261028020000_avatars.sql.

create table if not exists rentals.stamps (
  listing_id uuid not null references rentals.listings on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  stamped_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

alter table rentals.stamps enable row level security;
grant all on rentals.stamps to authenticated, service_role;

-- Both can read every stamp (that's how the partner's stamp shows). Each adds or removes only their own.
drop policy if exists stamps_read on rentals.stamps;
create policy stamps_read on rentals.stamps for select to authenticated using (true);

drop policy if exists stamps_insert on rentals.stamps;
create policy stamps_insert on rentals.stamps for insert to authenticated with check (user_id = auth.uid());

drop policy if exists stamps_delete on rentals.stamps;
create policy stamps_delete on rentals.stamps for delete to authenticated using (user_id = auth.uid());
