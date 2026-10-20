-- Fix for module 5.1: leads.created_at is a timestamp WITHOUT time zone (stored as UTC). The earlier view read it as
-- if it were already India time, which moved the date back by 5 hours 30 minutes: a lead created at 01:30 on 1 October
-- (India) counted on 30 September. Read it as UTC first, then convert to India time.
CREATE OR REPLACE VIEW v_daily_leads WITH (security_invoker = true) AS
SELECT l.branch_id,
       ((l.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS day,
       count(*)::int AS created,
       (count(*) FILTER (WHERE l.stage = 'WON'))::int AS won,
       (count(*) FILTER (WHERE l.stage = 'LOST'))::int AS lost
FROM leads l
GROUP BY l.branch_id, ((l.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date;
