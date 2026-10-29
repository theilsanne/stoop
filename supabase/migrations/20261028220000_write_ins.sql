-- Write-in criteria ("exposed brick", "good light") and the ticks that override them.
-- Run after 20261028010000_feed_commutes.sql. Safe to run more than once.
--
-- 1. criteria may use the new "mentions" operator: its value is a list of phrases,
--    met when the listing's description mentions one (scoring.ts).
-- 2. criterion_marks: a person's own tick (met) or untick (not met) on a listing,
--    for one of their write-ins. Both of you can read them; only the criterion's
--    owner can write them.
-- 3. the feed view gains description and marks at the end, so the app can score
--    write-ins and show your ticks.
-- 4. "Available before April 1" is renamed "Availability" (the date shows under it),
--    for both of you and for anyone who signs up later.

alter table rentals.criteria drop constraint if exists criteria_operator_check;
alter table rentals.criteria add constraint criteria_operator_check check (operator in
  ('lte','gte','eq','in','not_in','is_true','before','within_minutes','mentions'));

create table if not exists rentals.criterion_marks (
  criterion_id uuid not null references rentals.criteria on delete cascade,
  listing_id   uuid not null references rentals.listings on delete cascade,
  met          boolean not null,
  updated_at   timestamptz not null default now(),
  primary key (criterion_id, listing_id)
);

alter table rentals.criterion_marks enable row level security;
grant select, insert, update, delete on rentals.criterion_marks to authenticated, service_role;

drop policy if exists marks_read on rentals.criterion_marks;
create policy marks_read on rentals.criterion_marks for select to authenticated using (true);

drop policy if exists marks_write on rentals.criterion_marks;
create policy marks_write on rentals.criterion_marks for all to authenticated
  using (exists (select 1 from rentals.criteria c where c.id = criterion_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from rentals.criteria c where c.id = criterion_id and c.owner_id = auth.uid()));

create or replace view rentals.feed with (security_invoker = true) as
select l.*,
       s.score, s.passes, s.near_miss, s.failed, s.per_person,
       coalesce(t.stage, 'new') as stage,
       (select jsonb_object_agg(r.user_id, r.verdict)
          from rentals.ratings r where r.listing_id = l.id) as verdicts,
       b.hpd_open_violations,
       b.hpd_class_c_open,
       b.complaints_311_12mo,
       b.refreshed_at as building_checked_at,
       (select jsonb_object_agg(c.place_id, c.minutes)
          from rentals.commutes c where c.listing_id = l.id and c.minutes is not null) as commutes,
       coalesce(l.raw->>'description', l.raw->>'title') as description,
       (select jsonb_object_agg(m.criterion_id, m.met)
          from rentals.criterion_marks m where m.listing_id = l.id) as marks
from rentals.listings l
left join rentals.scores    s on s.listing_id = l.id
left join rentals.tracking  t on t.listing_id = l.id
left join rentals.buildings b on b.bbl = l.bbl
where l.status = 'active';

update rentals.criteria set label = 'Availability'
where field = 'available_date' and operator = 'before' and label = 'Available before April 1';

create or replace function rentals.handle_new_user() returns trigger
language plpgsql security definer set search_path = rentals, public as $$
begin
  insert into rentals.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  -- every new person starts with the one firm constraint; the rest is added in the app
  insert into rentals.criteria (owner_id, label, kind, field, operator, value, sort_order)
  values (new.id, 'Availability', 'dealbreaker', 'available_date', 'before', '"2027-04-01"', 0);
  return new;
end $$;
