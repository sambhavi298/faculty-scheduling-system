-- Phase 1, Task 1 (post-Level-7 development): closes the Break Report's
-- Gap A — book_appointment() previously only checked the exclusion
-- constraint against OTHER appointments; it never consulted
-- faculty_availability, faculty_schedule, or faculty_schedule_exceptions,
-- so a booking during a teaching block or declared leave would succeed.
--
-- Reuse, not duplication: get_available_slots() (0005) already contains the
-- authoritative "is this faculty member free" logic as a set-based CTE,
-- used to generate a whole day's candidate slots at once. That shape is
-- wrong for a single-slot check inside book_appointment() (turning a
-- set-based CTE into a per-row function call the way a naive reuse would is
-- itself an anti-pattern), so instead this migration extracts the same
-- underlying conditions into a single-slot scalar predicate,
-- is_faculty_available(), kept deliberately consistent with
-- get_available_slots()'s WHERE-clause logic (same tables, same exception
-- types, same window-containment rule) rather than introducing a different
-- notion of "available." Existing-appointment conflicts remain the
-- exclusion constraint's job (unchanged) — this function only adds the
-- three sources get_available_slots() already reads.

CREATE OR REPLACE FUNCTION is_faculty_available(
    p_faculty_id BIGINT,
    p_slot       TSTZRANGE
) RETURNS BOOLEAN AS $$
DECLARE
    v_date DATE     := lower(p_slot)::date;
    v_dow  SMALLINT := EXTRACT(DOW FROM lower(p_slot))::SMALLINT;
    v_within_window BOOLEAN;
    v_blocked        BOOLEAN;
BEGIN
    -- Source 1: the slot must fit entirely within ONE declared availability
    -- window for that faculty member on that day of week (same
    -- window-containment rule get_available_slots()'s candidate_slots CTE
    -- enforces by construction).
    SELECT EXISTS (
        SELECT 1
        FROM faculty_availability fa
        WHERE fa.faculty_id = p_faculty_id
          AND fa.is_active
          AND fa.day_of_week = v_dow
          AND fa.effective_from <= v_date
          AND (fa.effective_until IS NULL OR fa.effective_until >= v_date)
          AND lower(p_slot)::time >= fa.start_time
          AND upper(p_slot)::time <= fa.end_time
    ) INTO v_within_window;

    IF NOT v_within_window THEN
        RETURN FALSE;
    END IF;

    -- Source 2 (teaching schedule) and Source 3 (leave/meeting/block
    -- exceptions) — the exact same two UNION ALL branches
    -- get_available_slots()'s busy_ranges CTE uses for these two sources
    -- (its third UNION ALL branch, existing appointments, is intentionally
    -- NOT duplicated here — that remains the exclusion constraint's job).
    SELECT EXISTS (
        SELECT 1
        FROM faculty_schedule fs
        WHERE fs.faculty_id = p_faculty_id
          AND fs.day_of_week = v_dow
          AND fs.effective_from <= v_date
          AND (fs.effective_until IS NULL OR fs.effective_until >= v_date)
          AND tstzrange(v_date + fs.start_time, v_date + fs.end_time) && p_slot
        UNION ALL
        SELECT 1
        FROM faculty_schedule_exceptions fe
        WHERE fe.faculty_id = p_faculty_id
          AND fe.exception_date = v_date
          AND fe.exception_type IN ('LEAVE', 'MEETING', 'BLOCK')
          AND tstzrange(
                v_date + COALESCE(fe.start_time, TIME '00:00'),
                v_date + COALESCE(fe.end_time,   TIME '23:59:59')
              ) && p_slot
    ) INTO v_blocked;

    RETURN NOT v_blocked;
END;
$$ LANGUAGE plpgsql STABLE;

-- book_appointment() now rejects a slot that is not genuinely available
-- BEFORE attempting the insert (and therefore before the exclusion
-- constraint even runs) — this is the correctness guarantee living inside
-- the same database transaction as the write itself, not something the
-- frontend or Service layer could be trusted to enforce alone.
CREATE OR REPLACE FUNCTION book_appointment(
    p_student_id BIGINT,
    p_faculty_id BIGINT,
    p_slot       TSTZRANGE,
    p_reason     TEXT,
    p_client_request_id UUID DEFAULT NULL
) RETURNS appointments AS $$
DECLARE
    v_row appointments;
BEGIN
    IF NOT is_faculty_available(p_faculty_id, p_slot) THEN
        RAISE EXCEPTION 'FACULTY_UNAVAILABLE: the requested slot is outside faculty availability or falls during a teaching/leave/blocked period'
            USING ERRCODE = 'AV001';
    END IF;

    INSERT INTO appointments (student_id, faculty_id, slot, status, reason, client_request_id)
    VALUES (p_student_id, p_faculty_id, p_slot, 'PENDING', p_reason, p_client_request_id)
    RETURNING * INTO v_row;

    RETURN v_row;
EXCEPTION
    WHEN exclusion_violation THEN
        RAISE EXCEPTION 'SLOT_CONFLICT: the requested time overlaps an existing active appointment for this faculty member'
            USING ERRCODE = '23P01';
END;
$$ LANGUAGE plpgsql;
