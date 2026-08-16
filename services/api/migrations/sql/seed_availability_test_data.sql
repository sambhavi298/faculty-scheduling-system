-- Additional seed data, layered on top of seed_test_data.sql, specifically so
-- Level 7 can test availability computation (get_available_slots), and the
-- "appointment outside declared availability" attack, against real rows
-- instead of an empty schedule.
--
-- Fixed reference date used throughout Level 7's availability tests:
-- 2026-08-24 is a Monday (day_of_week = 1).

-- Prof. Rao (faculty 200): open for appointments Mon-Fri, 09:00-17:00.
INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time, effective_from, effective_until)
SELECT 200, d, '09:00', '17:00', '2026-01-01', NULL
FROM generate_series(1, 5) AS d
ON CONFLICT DO NOTHING;

-- Prof. Rao teaches CSE301 every Monday 10:00-11:00 — NOT bookable, even
-- though it falls inside the 09:00-17:00 availability window above.
INSERT INTO faculty_schedule (faculty_id, day_of_week, start_time, end_time, label, effective_from, effective_until)
VALUES (200, 1, '10:00', '11:00', 'CSE301 Lecture', '2026-01-01', NULL)
ON CONFLICT DO NOTHING;

-- Prof. Rao is on leave for the whole day on 2026-08-31.
INSERT INTO faculty_schedule_exceptions (faculty_id, exception_date, start_time, end_time, exception_type, reason)
VALUES (200, '2026-08-31', NULL, NULL, 'LEAVE', 'Conference travel')
ON CONFLICT DO NOTHING;

-- Batch 1 has a class Monday 09:30-10:30 (advisory only, per Level 5 Section 15).
INSERT INTO batch_schedule (batch_id, day_of_week, start_time, end_time, label)
VALUES (1, 1, '09:30', '10:30', 'DBMS Lab')
ON CONFLICT DO NOTHING;
