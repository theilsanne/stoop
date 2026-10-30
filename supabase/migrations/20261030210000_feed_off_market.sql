-- The feed view keeps off-market listings too, so a listing you stamped or said Yes to doesn't
-- vanish when StreetEasy says it's rented: the app shows those under "Off market".
-- The app asks for active listings (status = 'active') for everything else, as before.
-- Same columns as 20261028220000_write_ins.sql; only the last line (the status filter) is gone.
-- Safe to run more than once.

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
left join rentals.buildings b on b.bbl = l.bbl;
