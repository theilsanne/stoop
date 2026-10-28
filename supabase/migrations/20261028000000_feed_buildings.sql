-- Adds building records (HPD violations, 311 complaints) to the feed view.
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.
-- New columns go at the end, which "create or replace view" allows.

create or replace view rentals.feed with (security_invoker = true) as
select l.*,
       s.score, s.passes, s.near_miss, s.failed, s.per_person,
       coalesce(t.stage, 'new') as stage,
       (select jsonb_object_agg(r.user_id, r.verdict)
          from rentals.ratings r where r.listing_id = l.id) as verdicts,
       b.hpd_open_violations,
       b.hpd_class_c_open,
       b.complaints_311_12mo,
       b.refreshed_at as building_checked_at
from rentals.listings l
left join rentals.scores    s on s.listing_id = l.id
left join rentals.tracking  t on t.listing_id = l.id
left join rentals.buildings b on b.bbl = l.bbl
where l.status = 'active';
