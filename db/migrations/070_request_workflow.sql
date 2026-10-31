-- A student asks for access to one lecture; the instructor who uploaded it (or an admin)
-- approves or rejects. The rules live in triggers so they hold for every write path.

-- Only a student may raise a request.
CREATE TRIGGER trg_request_student_role
    BEFORE INSERT ON access_request
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('student_id', 'student');

-- A new request must target a lecture that has a transcript (i.e. an approver exists) and the
-- student must not already be able to reach that lecture.
CREATE FUNCTION fn_request_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM transcript WHERE lecture_id = NEW.lecture_id) THEN
        RAISE EXCEPTION 'lecture % has no transcript yet, so it has no approver', NEW.lecture_id
              USING ERRCODE = 'check_violation';
    END IF;
    IF has_lecture_access(NEW.student_id, NEW.lecture_id) THEN
        RAISE EXCEPTION 'student % already has access to lecture %', NEW.student_id, NEW.lecture_id
              USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := 'pending'; NEW.requested_at := now();  -- client cannot forge these
    NEW.decided_by := NULL; NEW.decided_at := NULL; NEW.expires_at := NULL;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_request_before_insert
    BEFORE INSERT ON access_request
    FOR EACH ROW EXECUTE FUNCTION fn_request_before_insert();

-- An update is a decision on a still-pending request: approve or reject, decided by the
-- uploader of the lecture or by an admin. The submitted fields are frozen.
CREATE FUNCTION fn_request_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.student_id, NEW.lecture_id, NEW.reason, NEW.requested_at)
       IS DISTINCT FROM (OLD.student_id, OLD.lecture_id, OLD.reason, OLD.requested_at) THEN
        RAISE EXCEPTION 'request % cannot be edited after submission', OLD.request_id
              USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'pending' THEN
        RAISE EXCEPTION 'request % was already %', OLD.request_id, OLD.status
              USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pending'
       AND NOT EXISTS (SELECT 1 FROM transcript t
                       WHERE t.lecture_id = NEW.lecture_id AND t.uploaded_by = NEW.decided_by)
       AND NOT EXISTS (SELECT 1 FROM app_user u
                       WHERE u.user_id = NEW.decided_by AND u.role = 'admin') THEN
        RAISE EXCEPTION 'user % may not decide request %', NEW.decided_by, OLD.request_id
              USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_request_before_update
    BEFORE UPDATE ON access_request
    FOR EACH ROW EXECUTE FUNCTION fn_request_before_update();

-- Student: request access to one lecture. Returns the new request id.
CREATE FUNCTION request_access(p_lecture_id integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id integer;
BEGIN
    INSERT INTO access_request (student_id, lecture_id, reason)
    VALUES (current_app_user(), p_lecture_id, btrim(p_reason))
    RETURNING request_id INTO v_id;
    RETURN v_id;
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you already have a pending request for this lecture'
          USING ERRCODE = 'unique_violation';
END $$;

-- Instructor/admin: approve or reject, atomically. FOR UPDATE locks the row, so if the
-- instructor and an admin click at the same moment, the second transaction waits and then
-- sees "already approved" instead of overwriting the first decision.
CREATE PROCEDURE decide_request(p_request_id integer, p_approve boolean, p_days integer DEFAULT 7)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r access_request%ROWTYPE;
BEGIN
    IF p_approve AND p_days NOT BETWEEN 1 AND 90 THEN
        RAISE EXCEPTION 'grant duration must be 1-90 days' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO r FROM access_request WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request % not found', p_request_id USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE access_request
       SET status     = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END::request_status,
           decided_by = current_app_user(),
           decided_at = now(),
           expires_at = CASE WHEN p_approve THEN now() + make_interval(days => p_days) END
     WHERE request_id = p_request_id;   -- trg_request_before_update enforces the rules
END $$;

-- Instructor/admin inbox: the pending requests the current user may decide.
CREATE FUNCTION my_pending_requests()
RETURNS TABLE (request_id integer, student_name varchar, course_code varchar,
               lecture_no smallint, lecture_title varchar, reason varchar, requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT r.request_id, s.full_name, co.code, l.lecture_no, l.title, r.reason, r.requested_at
    FROM access_request r
    JOIN app_user   s ON s.user_id   = r.student_id
    JOIN lecture    l ON l.lecture_id = r.lecture_id
    JOIN course     co ON co.course_id = l.course_id
    JOIN transcript t ON t.lecture_id = r.lecture_id
    WHERE r.status = 'pending'
      AND (t.uploaded_by = current_app_user()
           OR (SELECT role FROM app_user WHERE user_id = current_app_user()) = 'admin')
    ORDER BY r.requested_at
$$;

-- "My requests", with the derived Access column.
CREATE VIEW v_request_history WITH (security_invoker = true) AS
SELECT r.request_id, r.student_id, co.code AS course_code, l.lecture_no, l.title AS lecture_title,
       r.requested_at, r.status, r.expires_at,
       CASE WHEN r.status <> 'approved' THEN NULL
            WHEN r.expires_at > now()   THEN 'active'
            ELSE 'expired' END AS access_state
FROM access_request r
JOIN lecture l ON l.lecture_id = r.lecture_id
JOIN course co ON co.course_id = l.course_id;
