-- Migration 0007 — Phase 1, Task 2 (documented Gap 2): faculty_availability
-- overlap protection.
--
-- PROBLEM: faculty_availability had no database-level protection against
-- two ACTIVE windows for the same faculty member, on the same day of week,
-- with overlapping effective-date ranges, genuinely overlapping in time
-- (e.g. 09:00-12:00 and 11:00-14:00 on every Monday from 2026-01-01
-- onward). Nothing stopped two contradictory rows from existing at once.
-- is_faculty_available() and get_available_slots() (migrations 0005, 0006)
-- would silently see both rows rather than surface the contradiction —
-- get_available_slots() could even emit duplicate/overlapping slot rows.
-- This is exactly the failure mode behind the test-data-pollution incident
-- documented in tests/integration/negative-boundary-and-integrity.test.ts
-- (a single un-cleaned-up test insert silently corrupted availability
-- computation for every later run).
--
-- FIX: a GiST exclusion constraint — the same Advanced SQL mechanism
-- already used for appointments.slot in migration 0002 (EXCLUDE USING
-- gist), applied to a second table rather than introduced as a new
-- technique. Two changes make it possible here:
--
--   1. TIME has no built-in PostgreSQL range type (unlike TIMESTAMPTZ,
--      which is why appointments already uses TSTZRANGE), so a small
--      custom range type is created for it. This is the standard,
--      documented way to get exclusion-constraint support over a scalar
--      type PostgreSQL doesn't ship a range for (see CREATE TYPE ... AS
--      RANGE) — not a new dependency, no extension beyond btree_gist
--      (already installed in migration 0001).
--   2. The effective-date dimension reuses the built-in DATERANGE, with
--      '[]' bounds so a NULL effective_until (this schema's "ongoing
--      indefinitely" convention — see migration 0001) is correctly
--      treated as unbounded/infinite rather than excluded.
--
-- btree_gist supplies the GiST '=' operator class needed for the scalar
-- equality terms (faculty_id, day_of_week) inside the same index.
--
-- The exclusion is scoped WHERE (is_active) — the same pattern appointments
-- uses (WHERE status IN ('PENDING','APPROVED')): a row that has been
-- soft-deactivated no longer participates in the "is this a live,
-- contradictory window" check, mirroring how a CANCELLED appointment no
-- longer blocks a new booking for the same slot.
--
-- SCOPE NOTE: this constraint protects the data itself, independent of any
-- application code path — there is no FacultyAvailabilityRepository/Service
-- yet (faculty-managed availability editing is later work, once the HTTP/
-- auth layer exists — documented Gap 4). Until then, this is exercised
-- directly against PostgreSQL, the same way the existing
-- "Constraints enforced directly, independent of any application code"
-- tests in tests/advanced-sql/advanced-sql-features.test.ts already do for
-- the appointments exclusion constraint.

CREATE TYPE timerange AS RANGE (subtype = time);

ALTER TABLE faculty_availability
    ADD CONSTRAINT faculty_availability_no_overlap
    EXCLUDE USING gist (
        faculty_id  WITH =,
        day_of_week WITH =,
        timerange(start_time, end_time, '[)')             WITH &&,
        daterange(effective_from, effective_until, '[]')   WITH &&
    ) WHERE (is_active);
