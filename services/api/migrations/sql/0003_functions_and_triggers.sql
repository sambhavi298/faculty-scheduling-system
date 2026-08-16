-- State-transition guard (Level 5, Section 4) + updated_at maintenance
CREATE OR REPLACE FUNCTION enforce_appointment_transition() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'PENDING'  AND NEW.status IN ('APPROVED','REJECTED','CANCELLED','EXPIRED')) OR
        (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED','CANCELLED','MISSED'))
    ) THEN
        RAISE EXCEPTION 'INVALID_TRANSITION: % -> % is not allowed', OLD.status, NEW.status
            USING ERRCODE = '22023';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_transition
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION enforce_appointment_transition();

-- Audit trigger (Level 5, Section 6)
CREATE OR REPLACE FUNCTION audit_appointment_change() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (entity_type, entity_id, action, actor_id, old_data, new_data)
    VALUES (
        'appointment',
        NEW.id,
        TG_OP,
        COALESCE(NEW.responded_by, NEW.cancelled_by, NEW.student_id),
        CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_appointment
AFTER INSERT OR UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION audit_appointment_change();

-- Atomic booking function (Level 5, Section 5)
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
