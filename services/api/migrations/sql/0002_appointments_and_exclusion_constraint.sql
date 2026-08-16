CREATE TYPE appointment_status AS ENUM (
    'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'MISSED', 'EXPIRED'
);

CREATE TABLE appointments (
    id                  BIGSERIAL PRIMARY KEY,
    student_id          BIGINT NOT NULL REFERENCES students(id),
    faculty_id          BIGINT NOT NULL REFERENCES faculty(id),
    slot                TSTZRANGE NOT NULL,
    status              appointment_status NOT NULL DEFAULT 'PENDING',
    reason              TEXT NOT NULL,
    client_request_id   UUID,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at        TIMESTAMPTZ,
    responded_by        BIGINT REFERENCES faculty(id),
    cancelled_by        BIGINT REFERENCES users(id),
    completion_notes    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT appointments_reason_len_chk CHECK (char_length(reason) BETWEEN 5 AND 1000),
    CONSTRAINT appointments_slot_bounded_chk CHECK (
        lower(slot) IS NOT NULL AND upper(slot) IS NOT NULL AND upper(slot) > lower(slot)
    ),
    EXCLUDE USING gist (
        faculty_id WITH =,
        slot       WITH &&
    ) WHERE (status IN ('PENDING', 'APPROVED'))
);

CREATE UNIQUE INDEX appointments_idem_uq
    ON appointments (student_id, client_request_id)
    WHERE client_request_id IS NOT NULL;

CREATE INDEX appointments_student_status_idx ON appointments (student_id, status);
CREATE INDEX appointments_faculty_status_idx ON appointments (faculty_id, status);
CREATE INDEX faculty_availability_lookup_idx ON faculty_availability (faculty_id, day_of_week);
CREATE INDEX faculty_schedule_lookup_idx     ON faculty_schedule (faculty_id, day_of_week);
CREATE INDEX faculty_exceptions_lookup_idx   ON faculty_schedule_exceptions (faculty_id, exception_date);
CREATE INDEX batch_schedule_lookup_idx       ON batch_schedule (batch_id, day_of_week);

CREATE TABLE notifications (
    id              BIGSERIAL PRIMARY KEY,
    recipient_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id  BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
    type            TEXT NOT NULL,
    message         TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications (recipient_id, is_read);

CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     TEXT NOT NULL,
    entity_id       BIGINT NOT NULL,
    action          TEXT NOT NULL,
    actor_id        BIGINT REFERENCES users(id),
    old_data        JSONB,
    new_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
