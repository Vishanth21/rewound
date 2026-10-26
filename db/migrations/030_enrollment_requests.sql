CREATE TABLE enrollment (
    student_id  integer     REFERENCES app_user ON DELETE CASCADE,
    course_id   integer     REFERENCES course   ON DELETE CASCADE,
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, course_id)
);

CREATE INDEX idx_enrollment_course ON enrollment (course_id);

CREATE TRIGGER trg_enrollment_role
    BEFORE INSERT OR UPDATE ON enrollment
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('student_id', 'student');


-- One table holds both the request and (once approved) the grant.
-- A grant is "active" while status = 'approved' AND expires_at > now() -- no sweep job.
CREATE TABLE access_request (
    request_id   integer        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id   integer        NOT NULL REFERENCES app_user ON DELETE CASCADE,
    lecture_id   integer        NOT NULL REFERENCES lecture  ON DELETE CASCADE,
    reason       varchar(500)   NOT NULL CHECK (btrim(reason) <> ''),
    status       request_status NOT NULL DEFAULT 'pending',
    requested_at timestamptz    NOT NULL DEFAULT now(),
    decided_by   integer        REFERENCES app_user,
    decided_at   timestamptz,
    expires_at   timestamptz,
    CONSTRAINT chk_decision_fields CHECK (
        (status = 'pending'  AND decided_by IS NULL     AND decided_at IS NULL     AND expires_at IS NULL)
     OR (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND expires_at IS NULL)
     OR (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
         AND expires_at > decided_at
         AND expires_at <= decided_at + interval '90 days')
    )
);

-- No duplicate pending request for the same (student, lecture) 
CREATE UNIQUE INDEX uq_one_pending_request
    ON access_request (student_id, lecture_id)
    WHERE status = 'pending';

-- Fast student active grant lookups
CREATE INDEX idx_request_grants
    ON access_request (student_id, lecture_id, expires_at)
    WHERE status = 'approved';

CREATE INDEX idx_request_lecture_status ON access_request (lecture_id, status);
