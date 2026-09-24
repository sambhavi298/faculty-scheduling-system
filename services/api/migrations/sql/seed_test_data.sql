-- Minimal reference data used by every test: 1 department, 1 batch, 2 students, 1 faculty member.
INSERT INTO departments (id, name, code) VALUES (1, 'Computer Science', 'CSE') ON CONFLICT DO NOTHING;
INSERT INTO batches (id, department_id, name, academic_year) VALUES (1, 1, 'CSE Batch 1', '2026-2027') ON CONFLICT DO NOTHING;

-- Every seeded user's password is 'Password123!' — real bcrypt hashes,
-- generated via pgcrypto's crypt()/gen_salt('bf') (migrations/sql/0009),
-- not the placeholder 'x' this column held before real authentication
-- existed. This is fixture data for a local dev/test database only (see
-- README's run instructions) — never a production credential. Cost factor 4
-- (vs. bcrypt's usual default of 10-12) is deliberate: this data gets
-- re-seeded before nearly every test run, and bcrypt is deliberately slow —
-- a low cost factor keeps the test suite fast without weakening anything a
-- real deployment relies on (application code, src/services/auth.service.ts,
-- always uses the `bcrypt` package's own default cost when hashing a real
-- user's password; this cost factor only affects these five seeded rows).
INSERT INTO users (id, email, password_hash, full_name, role) VALUES
  (100, 'alice@example.edu', crypt('Password123!', gen_salt('bf', 4)), 'Alice Student', 'STUDENT'),
  (101, 'bob@example.edu', crypt('Password123!', gen_salt('bf', 4)), 'Bob Student', 'STUDENT'),
  (200, 'prof.rao@example.edu', crypt('Password123!', gen_salt('bf', 4)), 'Prof. Rao', 'FACULTY'),
  (201, 'prof.iyer@example.edu', crypt('Password123!', gen_salt('bf', 4)), 'Prof. Iyer', 'FACULTY'),
  (900, 'admin@example.edu', crypt('Password123!', gen_salt('bf', 4)), 'Admin User', 'ADMIN')
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
