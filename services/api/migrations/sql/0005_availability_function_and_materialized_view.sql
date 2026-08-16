-- Completes the remaining Level 5, Section 6 SQL objects that were designed
-- but not yet migrated as of the end of Level 6: the availability-computation
-- function (CTEs) and the reporting materialized view. Added here, at the
-- start of Level 7, specifically so "Advanced SQL Tests" (Section 12) can
-- genuinely execute and verify them against real data, not just cite the
-- design document.

CREATE OR REPLACE FUNCTION get_available_slots(
    p_faculty_id   BIGINT,
    p_date         DATE,
    p_slot_minutes INTEGER DEFAULT 30
)
RETURNS TABLE (slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ) AS $$
WITH
day_bounds AS (
    SELECT EXTRACT(DOW FROM p_date)::SMALLINT AS dow
),
open_windows AS (
    SELECT fa.start_time, fa.end_time
    FROM faculty_availability fa, day_bounds db
    WHERE fa.faculty_id = p_faculty_id
      AND fa.is_active
      AND fa.day_of_week = db.dow
      AND fa.effective_from <= p_date
      AND (fa.effective_until IS NULL OR fa.effective_until >= p_date)
),
candidate_slots AS (
    SELECT
        (p_date + ow.start_time)::TIMESTAMPTZ + (n || ' minutes')::INTERVAL AS c_start,
        (p_date + ow.start_time)::TIMESTAMPTZ + ((n + p_slot_minutes) || ' minutes')::INTERVAL AS c_end
    FROM open_windows ow,
         generate_series(
             0,
             (EXTRACT(EPOCH FROM (ow.end_time - ow.start_time))::INTEGER / 60) - p_slot_minutes,
             p_slot_minutes
         ) AS n
),
busy_ranges AS (
    SELECT tstzrange(p_date + fs.start_time, p_date + fs.end_time) AS busy
    FROM faculty_schedule fs, day_bounds db
    WHERE fs.faculty_id = p_faculty_id
      AND fs.day_of_week = db.dow
      AND fs.effective_from <= p_date
      AND (fs.effective_until IS NULL OR fs.effective_until >= p_date)
    UNION ALL
    SELECT tstzrange(
        p_date + COALESCE(fe.start_time, TIME '00:00'),
        p_date + COALESCE(fe.end_time,   TIME '23:59:59')
    )
    FROM faculty_schedule_exceptions fe
    WHERE fe.faculty_id = p_faculty_id
      AND fe.exception_date = p_date
      AND fe.exception_type IN ('LEAVE', 'MEETING', 'BLOCK')
    UNION ALL
    SELECT a.slot
    FROM appointments a
    WHERE a.faculty_id = p_faculty_id
      AND a.status IN ('PENDING', 'APPROVED')
      AND a.slot && tstzrange(p_date, p_date + INTERVAL '1 day')
)
SELECT cs.c_start, cs.c_end
FROM candidate_slots cs
WHERE NOT EXISTS (
    SELECT 1 FROM busy_ranges br WHERE br.busy && tstzrange(cs.c_start, cs.c_end)
)
ORDER BY cs.c_start;
$$ LANGUAGE sql STABLE;

CREATE MATERIALIZED VIEW faculty_appointment_stats AS
SELECT
    f.id AS faculty_id,
    u.full_name,
    COUNT(*) FILTER (WHERE a.status = 'COMPLETED') AS completed_count,
    COUNT(*) FILTER (WHERE a.status = 'MISSED')    AS missed_count,
    COUNT(*) FILTER (WHERE a.status = 'REJECTED')  AS rejected_count,
    COUNT(*) FILTER (WHERE a.status = 'CANCELLED') AS cancelled_count,
    ROUND(AVG(EXTRACT(EPOCH FROM (a.responded_at - a.requested_at)) / 60)
          FILTER (WHERE a.responded_at IS NOT NULL), 1) AS avg_response_minutes,
    -- COUNT(a.id), NOT COUNT(*): found during Level 7 testing that COUNT(*)
    -- over this LEFT JOIN counts the joined-but-all-NULL row produced for a
    -- faculty member with zero appointments, incorrectly reporting
    -- total_requests = 1 instead of 0. COUNT(a.id) is NULL-aware and fixes it.
    COUNT(a.id) AS total_requests
FROM faculty f
JOIN users u ON u.id = f.id
LEFT JOIN appointments a ON a.faculty_id = f.id
GROUP BY f.id, u.full_name;

CREATE UNIQUE INDEX faculty_appointment_stats_faculty_idx ON faculty_appointment_stats (faculty_id);
