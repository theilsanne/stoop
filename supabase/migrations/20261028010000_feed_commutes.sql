-- Adds commute minutes to the feed view, as {place_id: minutes}.
-- Run after 20261028000000_feed_buildings.sql. Safe to run more than once.

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
          from rentals.commutes c where c.listing_id = l.id and c.minutes is not null) as commutes
from rentals.listings l
left join rentals.scores    s on s.listing_id = l.id
left join rentals.tracking  t on t.listing_id = l.id
left join rentals.buildings b on b.bbl = l.bbl
where l.status = 'active';
