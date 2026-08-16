CREATE VIEW faculty_current_status AS
SELECT
    f.id AS faculty_id,
    u.full_name,
    d.name AS department,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM faculty_schedule fs
            WHERE fs.faculty_id = f.id
              AND fs.day_of_week = EXTRACT(DOW FROM now())::SMALLINT
              AND now()::TIME BETWEEN fs.start_time AND fs.end_time
        ) THEN 'IN_CLASS'
        WHEN EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.faculty_id = f.id AND a.status = 'APPROVED' AND a.slot @> now()
        ) THEN 'IN_APPOINTMENT'
        WHEN EXISTS (
            SELECT 1 FROM faculty_schedule_exceptions fe
            WHERE fe.faculty_id = f.id AND fe.exception_date = CURRENT_DATE
              AND fe.exception_type IN ('LEAVE','MEETING','BLOCK')
              AND (fe.start_time IS NULL OR now()::TIME BETWEEN fe.start_time AND fe.end_time)
        ) THEN 'UNAVAILABLE'
        ELSE 'FREE'
    END AS current_status
FROM faculty f
JOIN users u ON u.id = f.id
JOIN departments d ON d.id = f.department_id;

CREATE VIEW student_upcoming_appointments AS
SELECT a.id, a.student_id, a.faculty_id, u.full_name AS faculty_name, a.slot, a.status, a.reason
FROM appointments a
JOIN faculty f ON f.id = a.faculty_id
JOIN users u ON u.id = f.id
WHERE a.status IN ('PENDING','APPROVED') AND lower(a.slot) >= now();

CREATE VIEW faculty_pending_requests AS
SELECT a.id, a.faculty_id, a.student_id, u.full_name AS student_name, s.roll_number,
       a.slot, a.reason, a.requested_at
FROM appointments a
JOIN students s ON s.id = a.student_id
JOIN users u ON u.id = s.id
WHERE a.status = 'PENDING'
ORDER BY a.requested_at;
