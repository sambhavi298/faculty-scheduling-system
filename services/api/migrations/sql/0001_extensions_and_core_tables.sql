-- Level 5, Section 3 schema, applied verbatim for Level 6 implementation.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('STUDENT', 'FACULTY', 'ADMIN');

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    role            user_role NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (LOWER(email));

CREATE TABLE departments (
    id      SERIAL PRIMARY KEY,
    name    TEXT NOT NULL,
    code    TEXT NOT NULL,
    CONSTRAINT departments_code_uq UNIQUE (code)
);

CREATE TABLE batches (
    id              SERIAL PRIMARY KEY,
    department_id   INTEGER NOT NULL REFERENCES departments(id),
    name            TEXT NOT NULL,
    academic_year   TEXT NOT NULL,
    CONSTRAINT batches_dept_name_year_uq UNIQUE (department_id, name, academic_year)
);

CREATE TABLE students (
    id              BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    batch_id        INTEGER NOT NULL REFERENCES batches(id),
    roll_number     TEXT NOT NULL,
    CONSTRAINT students_roll_number_uq UNIQUE (roll_number)
);

CREATE TABLE faculty (
    id              BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    department_id   INTEGER NOT NULL REFERENCES departments(id),
    staff_code      TEXT NOT NULL,
    office_location TEXT,
    CONSTRAINT faculty_staff_code_uq UNIQUE (staff_code)
);

CREATE TABLE faculty_availability (
    id              BIGSERIAL PRIMARY KEY,
    faculty_id      BIGINT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    effective_from  DATE NOT NULL,
    effective_until DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT faculty_availability_time_chk  CHECK (end_time > start_time),
    CONSTRAINT faculty_availability_range_chk CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE TABLE faculty_schedule (
    id              BIGSERIAL PRIMARY KEY,
    faculty_id      BIGINT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    label           TEXT NOT NULL,
    effective_from  DATE NOT NULL,
    effective_until DATE,
    CONSTRAINT faculty_schedule_time_chk  CHECK (end_time > start_time),
    CONSTRAINT faculty_schedule_range_chk CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE TYPE schedule_exception_type AS ENUM ('LEAVE', 'MEETING', 'BLOCK', 'EXTRA_AVAILABLE');

CREATE TABLE faculty_schedule_exceptions (
    id              BIGSERIAL PRIMARY KEY,
    faculty_id      BIGINT NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    exception_date  DATE NOT NULL,
    start_time      TIME,
    end_time        TIME,
    exception_type  schedule_exception_type NOT NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT faculty_exception_time_chk CHECK (
        (start_time IS NULL AND end_time IS NULL) OR (end_time > start_time)
    )
);

CREATE TABLE batch_schedule (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    label           TEXT NOT NULL,
    CONSTRAINT batch_schedule_time_chk CHECK (end_time > start_time)
);
