-- Brooklyn rental hunt — Supabase schema
-- Paste into Supabase → SQL Editor → Run.
-- Everything lives in its own `rentals` schema.
-- After running: Project Settings → Data API → Exposed schemas → add `rentals`.

create schema if not exists rentals;
set search_path = rentals, public;

-- ---------- enums ----------
create type rentals.listing_status as enum ('active', 'off_market');
create type rentals.pipeline_stage as enum ('new', 'shortlisted', 'tour_requested', 'toured', 'applied', 'won', 'passed');
create type rentals.criterion_kind as enum ('dealbreaker', 'want');
create type rentals.verdict as enum ('yes', 'maybe', 'no');

-- ---------- people & places ----------
create table rentals.profiles (
  id               uuid primary key references auth.users on delete cascade,
  display_name     text not null default '',
  notify_threshold int  not null default 70,      -- alert when score >= this
  quiet_start      time,                           -- no alerts between these times
  quiet_end        time
);

create table rentals.places (                      -- commute destinations (offices, etc.)
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users on delete cascade,
  label     text not null,                         -- e.g. 'Ethelia office'
  address   text not null,
  lat       double precision,
  lng       double precision
);

-- ---------- what to scrape (cast the net wide here; criteria do the ranking) ----------
create table rentals.search_scopes (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,                       -- e.g. 'Crown Heights 1–2BR'
  source      text not null default 'streeteasy',
  search_url  text not null,                       -- a StreetEasy search URL, sorted newest first
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- listings ----------
create table rentals.listings (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,                -- 'streeteasy' | 'zillow' | 'manual'
  source_id          text not null,                -- the site's own listing id
  url                text not null,
  address            text,
  unit               text,
  neighborhood       text,
  lat                double precision,
  lng                double precision,
  bbl                text,                         -- NYC borough-block-lot, joins to buildings
  price              int,                          -- asking rent, $/month
  net_effective_rent int,                          -- after free months
  free_months        numeric,
  lease_term_months  int,
  no_fee             boolean,
  fees               jsonb,                        -- itemized fees as scraped
  beds               numeric,
  baths              numeric,
  sqft               int,
  available_date     date,
  amenities          jsonb not null default '{}',  -- {"laundry_in_unit":true,"dishwasher":true,...}
  photos             text[] not null default '{}',
  status             rentals.listing_status not null default 'active',
  listed_at          timestamptz,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  raw                jsonb,                        -- full scraper row, for fields you add later
  unique (source, source_id)
);
create index on rentals.listings (status, first_seen_at desc);

create table rentals.price_history (
  listing_id uuid not null references rentals.listings on delete cascade,
  price      int,
  seen_at    timestamptz not null default now()
);

create or replace function rentals.log_price_change() returns trigger
language plpgsql set search_path = rentals, public as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into rentals.price_history (listing_id, price) values (new.id, new.price);
  end if;
  return new;
end $$;

create trigger listings_price_log
after insert or update of price on rentals.listings
for each row execute function rentals.log_price_change();

-- ---------- enrichment ----------
create table rentals.buildings (                   -- NYC Open Data, one row per building
  bbl                  text primary key,
  hpd_open_violations  int,
  hpd_class_c_open     int,                        -- immediately hazardous
  complaints_311_12mo  int,
  rent_stabilized      boolean,
  refreshed_at         timestamptz not null default now()
);

create table rentals.commutes (
  listing_id  uuid not null references rentals.listings on delete cascade,
  place_id    uuid not null references rentals.places on delete cascade,
  minutes     int,
  mode        text not null default 'transit',
  computed_at timestamptz not null default now(),
  primary key (listing_id, place_id)
);

-- ---------- criteria: the living config the editor writes to ----------
create table rentals.criteria (                    -- each person keeps their own list
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users on delete cascade default auth.uid(),
  label            text not null,                  -- shown in the UI
  kind             rentals.criterion_kind not null,
  field            text not null,                  -- 'net_effective_rent', 'beds', 'neighborhood',
                                                   -- 'amenities.laundry_in_unit', 'commute:<place id>', ...
  operator         text not null check (operator in
                     ('lte','gte','eq','in','not_in','is_true','before','within_minutes')),
  value            jsonb,                          -- 3200 | ["Crown Heights","Prospect Heights"] | "2027-04-01"
  weight           int not null default 5 check (weight between 0 and 10),  -- wants only
  near_miss_margin numeric,                        -- e.g. 0.05 → within 5% shows as a near miss
  active           boolean not null default true,
  sort_order       int not null default 0,
  updated_by       uuid references auth.users default auth.uid(),
  updated_at       timestamptz not null default now()
);

create table rentals.criteria_log (                -- who changed what, and when
  id           bigint generated always as identity primary key,
  criterion_id uuid,
  changed_by   uuid default auth.uid(),
  changed_at   timestamptz not null default now(),
  before       jsonb,
  after        jsonb
);

create or replace function rentals.log_criteria_change() returns trigger
language plpgsql set search_path = rentals, public as $$
begin
  insert into rentals.criteria_log (criterion_id, before, after)
  values (coalesce(new.id, old.id),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger criteria_audit
after insert or update or delete on rentals.criteria
for each row execute function rentals.log_criteria_change();

-- ---------- results of scoring ----------
create table rentals.scores (                      -- combined score for the two of you
  listing_id  uuid primary key references rentals.listings on delete cascade,
  score       int not null,                        -- 0–100, average of each person's score
  passes      boolean not null,                    -- passes everyone's dealbreakers
  near_miss   boolean not null default false,      -- every miss is within its near-miss margin
  failed      text[] not null default '{}',        -- e.g. 'Net effective rent (owner uuid)'
  per_person  jsonb not null default '{}',         -- {owner_id: {score, passes, near_miss, failed, breakdown}}
  computed_at timestamptz not null default now()
);

-- ---------- the two of you ----------
create table rentals.ratings (
  listing_id uuid not null references rentals.listings on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  verdict    rentals.verdict,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create table rentals.tracking (
  listing_id uuid primary key references rentals.listings on delete cascade,
  stage      rentals.pipeline_stage not null default 'new',
  tour_at    timestamptz,
  notes      text,
  updated_by uuid references auth.users default auth.uid(),
  updated_at timestamptz not null default now()
);

create table rentals.alerts (                      -- so nothing is sent twice
  id         bigint generated always as identity primary key,
  listing_id uuid not null references rentals.listings on delete cascade,
  channel    text not null,                        -- 'web_push' | 'digest'
  reason     text,                                 -- 'new_high_score' | 'price_drop'
  sent_at    timestamptz not null default now(),
  unique (listing_id, channel, reason)
);

create table rentals.push_subscriptions (          -- one per phone that tapped "Turn on alerts"
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ---------- the feed the PWA reads ----------
create view rentals.feed with (security_invoker = true) as
select l.*,
       s.score, s.passes, s.near_miss, s.failed, s.per_person,
       coalesce(t.stage, 'new') as stage,
       (select jsonb_object_agg(r.user_id, r.verdict)
          from rentals.ratings r where r.listing_id = l.id) as verdicts
from rentals.listings l
left join rentals.scores   s on s.listing_id = l.id
left join rentals.tracking t on t.listing_id = l.id
where l.status = 'active';

-- ---------- auto-create a profile for each signed-in user ----------
create or replace function rentals.handle_new_user() returns trigger
language plpgsql security definer set search_path = rentals, public as $$
begin
  insert into rentals.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  -- every new person starts with the one firm constraint; the rest is added in the app
  insert into rentals.criteria (owner_id, label, kind, field, operator, value, sort_order)
  values (new.id, 'Available before April 1', 'dealbreaker', 'available_date', 'before', '"2027-04-01"', 0);
  return new;
end $$;

create trigger rentals_on_auth_user_created
after insert on auth.users
for each row execute function rentals.handle_new_user();

-- ---------- access ----------
-- Sign-ups are disabled, so "authenticated" means one of you two.
-- The ingest/scoring edge functions use the service role and bypass RLS.
grant usage on schema rentals to anon, authenticated, service_role;
grant all on all tables in schema rentals to authenticated, service_role;
grant all on all sequences in schema rentals to authenticated, service_role;
alter default privileges in schema rentals grant all on tables to authenticated, service_role;
alter default privileges in schema rentals grant all on sequences to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['profiles','places','search_scopes','listings','price_history','buildings',
                           'commutes','criteria_log','scores','tracking','alerts',
                           'push_subscriptions'] loop
    execute format('alter table rentals.%I enable row level security', t);
    execute format('create policy household_all on rentals.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ratings: both can read both; each writes only their own
alter table rentals.ratings enable row level security;
create policy ratings_read  on rentals.ratings for select to authenticated using (true);
create policy ratings_write on rentals.ratings for insert to authenticated with check (user_id = auth.uid());
create policy ratings_edit  on rentals.ratings for update to authenticated using (user_id = auth.uid());

-- criteria: both can read both lists (that's how Compare works); each edits only their own
alter table rentals.criteria enable row level security;
create policy criteria_read   on rentals.criteria for select to authenticated using (true);
create policy criteria_insert on rentals.criteria for insert to authenticated with check (owner_id = auth.uid());
create policy criteria_update on rentals.criteria for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy criteria_delete on rentals.criteria for delete to authenticated using (owner_id = auth.uid());

-- Starter criteria are added per person when each account is created (see handle_new_user).
