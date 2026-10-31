-- Who may see which lecture. The role is set by the app with
-- SELECT set_config('lecturelens.user_id', $1, true), and every function below reads it
-- through current_app_user().

CREATE FUNCTION current_app_user() RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('lecturelens.user_id', true), '')::integer
$$;

-- Access to a lecture: either enrolled in its course, OR holds an unexpired approval.
CREATE FUNCTION has_lecture_access(p_student integer, p_lecture integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM lecture l
                   JOIN enrollment e ON e.course_id = l.course_id
                   WHERE l.lecture_id = p_lecture AND e.student_id = p_student)
        OR EXISTS (SELECT 1 FROM access_request r
                   WHERE r.student_id = p_student AND r.lecture_id = p_lecture
                     AND r.status = 'approved' AND r.expires_at > now())
$$;

-- Every lecture the user may read: all of them for an admin, the ones they teach for an
-- instructor, and the ones they can reach for a student.
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

-- One row per way a student holds a lecture: enrolment (never expires) or an approved grant.
CREATE VIEW v_student_access AS
SELECT e.student_id, l.lecture_id, 'enrollment'::text AS via, NULL::timestamptz AS expires_at
FROM enrollment e
JOIN lecture l ON l.course_id = e.course_id
UNION ALL
SELECT r.student_id, r.lecture_id, 'grant', r.expires_at
FROM access_request r
WHERE r.status = 'approved' AND r.expires_at > now();
