-- psql -v app_pw="$APP_DB_PASSWORD" -v analyst_pw="$ANALYST_DB_PASSWORD" -f 100_roles_rls.sql

CREATE ROLE lecturelens_app     LOGIN PASSWORD :'app_pw';      -- used by the Next.js API
CREATE ROLE lecturelens_analyst LOGIN PASSWORD :'analyst_pw';  -- read-only reporting

REVOKE ALL ON ALL TABLES     IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS  IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lecturelens_app, lecturelens_analyst;

-- Plain CRUD the admin/instructor screens need.
GRANT SELECT, INSERT, UPDATE, DELETE ON app_user, enrollment, course_instructor TO lecturelens_app;
GRANT SELECT, UPDATE, DELETE ON course TO lecturelens_app;

-- Column-level privilege: the app can write youtube_video_id but never read it directly;
-- the video id leaves the database only through search_lectures() / get_lecture(),
-- which check access first.
GRANT SELECT (lecture_id, course_id, lecture_no, title, duration_sec, delivered_on, created_by, created_at)
    ON lecture TO lecturelens_app;
GRANT INSERT (course_id, lecture_no, title, youtube_video_id, duration_sec, delivered_on, created_by),
      UPDATE (lecture_no, title, youtube_video_id, duration_sec, delivered_on),
      DELETE ON lecture TO lecturelens_app;
GRANT SELECT ON access_request TO lecturelens_app;  -- writes only via request_access / decide_request
-- transcript, transcript_chunk, search_log, search_hit: NO direct privileges at all.

GRANT EXECUTE ON FUNCTION current_app_user(), accessible_lectures(integer), has_lecture_access(integer, integer),
                           search_lectures(vector, integer, real), search_lectures_keyword(text, integer),
                           get_lecture(integer), get_thumbnail_source(integer), log_search(text, varchar, jsonb),
                           request_access(integer, text), my_pending_requests()
    TO lecturelens_app;
GRANT EXECUTE ON PROCEDURE create_course(varchar, varchar, integer, integer[], integer),
                            ingest_transcript(integer, varchar, text, jsonb, integer, numeric, boolean),
                            set_chunk_embeddings(integer, jsonb),
                            decide_request(integer, boolean, integer)
    TO lecturelens_app;

GRANT SELECT ON v_request_history, v_course_overview, v_course_access_demand, v_pending_by_approver,
                v_course_search_activity, v_unanswered_queries, mv_daily_course_searches
    TO lecturelens_app;
GRANT SELECT ON v_course_overview, v_course_access_demand, v_course_search_activity,
                v_unanswered_queries, mv_daily_course_searches
    TO lecturelens_analyst;

-- Row-level security on access_request: a student sees only their own requests, an instructor
-- the requests they approve, an admin everything. Applies to lecturelens_app (not the owner).
CREATE FUNCTION can_see_request(p_student integer, p_lecture integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p_student = current_app_user()
        OR EXISTS (SELECT 1 FROM transcript t
                   WHERE t.lecture_id = p_lecture AND t.uploaded_by = current_app_user())
        OR EXISTS (SELECT 1 FROM app_user u
                   WHERE u.user_id = current_app_user() AND u.role = 'admin')
$$;

GRANT EXECUTE ON FUNCTION can_see_request(integer, integer) TO lecturelens_app;

ALTER TABLE access_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_visibility ON access_request
    FOR SELECT TO lecturelens_app
    USING (can_see_request(student_id, lecture_id));
