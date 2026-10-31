-- 115_course_lectures.sql  (owner: Member A)
-- Runs after 110 because it reads lecture.description, which 110 adds.

-- Instructor/admin screen: every lecture of a course with its transcript status. The app role
-- cannot read youtube_video_id, transcript or transcript_chunk directly, so this function is the
-- only way a manager sees them, and it checks that the caller manages the course first.
CREATE FUNCTION course_lectures(p_course_id integer)
RETURNS TABLE (lecture_id integer, lecture_no smallint, title varchar, youtube_video_id char(11),
               duration_sec integer, delivered_on date, description varchar,
               transcript_status varchar, chunk_count bigint, embedded_chunks bigint,
               uploaded_by_name varchar, uploaded_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT ((SELECT role FROM app_user WHERE user_id = current_app_user()) = 'admin'
            OR EXISTS (SELECT 1 FROM course_instructor ci
                       WHERE ci.course_id = p_course_id AND ci.instructor_id = current_app_user())) THEN
        RAISE EXCEPTION 'not allowed to manage course %', p_course_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    SELECT l.lecture_id, l.lecture_no, l.title, l.youtube_video_id, l.duration_sec, l.delivered_on,
           l.description, t.status, count(c.chunk_id), count(c.embedding), u.full_name, t.uploaded_at
    FROM lecture l
    LEFT JOIN transcript t       ON t.lecture_id = l.lecture_id
    LEFT JOIN app_user u         ON u.user_id = t.uploaded_by
    LEFT JOIN transcript_chunk c ON c.lecture_id = l.lecture_id
    WHERE l.course_id = p_course_id
    GROUP BY l.lecture_id, t.lecture_id, u.user_id
    ORDER BY l.lecture_no;
END $$;
