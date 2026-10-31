-- STUB of Member B's 050_access_functions.sql (taken from the design plan, section 11).
-- Used ONLY by db/tests/run_tests.py when db/migrations/050_* is not in the repo yet.
CREATE FUNCTION current_app_user() RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('lecturelens.user_id', true), '')::integer
$$;

CREATE FUNCTION has_lecture_access(p_student integer, p_lecture integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM lecture l
                   JOIN enrollment e ON e.course_id = l.course_id
                   WHERE l.lecture_id = p_lecture AND e.student_id = p_student)
        OR EXISTS (SELECT 1 FROM access_request r
                   WHERE r.student_id = p_student AND r.lecture_id = p_lecture
                     AND r.status = 'approved' AND r.expires_at > now())
$$;

CREATE FUNCTION accessible_lectures(p_user integer)
RETURNS TABLE (lecture_id integer) LANGUAGE sql STABLE AS $$
    SELECT l.lecture_id
    FROM lecture l
    CROSS JOIN (SELECT role FROM app_user WHERE user_id = p_user) u
    WHERE CASE u.role
            WHEN 'admin'      THEN true
            WHEN 'instructor' THEN EXISTS (SELECT 1 FROM course_instructor ci
                                           WHERE ci.course_id = l.course_id AND ci.instructor_id = p_user)
            WHEN 'student'    THEN has_lecture_access(p_user, l.lecture_id)
          END
$$;

CREATE VIEW v_student_access AS
SELECT e.student_id, l.lecture_id, 'enrollment'::text AS via, NULL::timestamptz AS expires_at
FROM enrollment e JOIN lecture l ON l.course_id = e.course_id
UNION ALL
SELECT r.student_id, r.lecture_id, 'grant', r.expires_at
FROM access_request r WHERE r.status = 'approved' AND r.expires_at > now();
