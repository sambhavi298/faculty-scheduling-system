-- Minimal reference data used by every test: 1 department, 1 batch, 2 students, 1 faculty member.
INSERT INTO departments (id, name, code) VALUES (1, 'Computer Science', 'CSE') ON CONFLICT DO NOTHING;
INSERT INTO batches (id, department_id, name, academic_year) VALUES (1, 1, 'CSE Batch 1', '2026-2027') ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, password_hash, full_name, role) VALUES
  (100, 'alice@example.edu', 'x', 'Alice Student', 'STUDENT'),
  (101, 'bob@example.edu', 'x', 'Bob Student', 'STUDENT'),
  (200, 'prof.rao@example.edu', 'x', 'Prof. Rao', 'FACULTY'),
  (201, 'prof.iyer@example.edu', 'x', 'Prof. Iyer', 'FACULTY')
ON CONFLICT DO NOTHING;

INSERT INTO students (id, batch_id, roll_number) VALUES
  (100, 1, 'CSE2026-001'),
  (101, 1, 'CSE2026-002')
ON CONFLICT DO NOTHING;

INSERT INTO faculty (id, department_id, staff_code, office_location) VALUES
  (200, 1, 'CSE-F01', 'Block A - 204'),
  (201, 1, 'CSE-F02', 'Block A - 210')
ON CONFLICT DO NOTHING;

SELECT setval('users_id_seq', 1000, false);
SELECT setval('appointments_id_seq', 1, false);
SELECT setval('audit_log_id_seq', 1, false);
