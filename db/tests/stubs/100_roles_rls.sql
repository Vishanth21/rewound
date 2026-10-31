-- STUB of Member B's 100_roles_rls.sql, trimmed to the objects Member A's migrations create.
-- Used ONLY by db/tests/run_tests.py when db/migrations/100_* is not in the repo yet.
CREATE ROLE lecturelens_app     LOGIN PASSWORD :'app_pw';
CREATE ROLE lecturelens_analyst LOGIN PASSWORD :'analyst_pw';

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO lecturelens_app, lecturelens_analyst;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_user, enrollment, course_instructor TO lecturelens_app;
GRANT SELECT, UPDATE, DELETE ON course TO lecturelens_app;
-- Column privilege: the app can write youtube_video_id but never read it directly.
GRANT SELECT (lecture_id, course_id, lecture_no, title, duration_sec, delivered_on, created_by, created_at)
    ON lecture TO lecturelens_app;
GRANT INSERT (course_id, lecture_no, title, youtube_video_id, duration_sec, delivered_on, created_by),
      UPDATE (lecture_no, title, youtube_video_id, duration_sec, delivered_on),
      DELETE ON lecture TO lecturelens_app;
GRANT SELECT ON access_request TO lecturelens_app;
-- transcript, transcript_chunk, search_log, search_hit: NO direct privileges at all.

GRANT EXECUTE ON FUNCTION current_app_user(), accessible_lectures(integer),
      has_lecture_access(integer, integer),
      search_lectures(vector, integer, real), search_lectures_keyword(text, integer),
      get_lecture(integer), get_thumbnail_source(integer), log_search(text, varchar, jsonb)
    TO lecturelens_app;
GRANT EXECUTE ON PROCEDURE create_course(varchar, varchar, integer, integer[], integer),
      ingest_transcript(integer, varchar, text, jsonb, integer, numeric, boolean),
      set_chunk_embeddings(integer, jsonb)
    TO lecturelens_app;
GRANT SELECT ON v_course_overview, v_course_search_activity, v_unanswered_queries,
      mv_daily_course_searches TO lecturelens_app;
GRANT SELECT ON v_course_overview, v_unanswered_queries, v_course_search_activity,
      mv_daily_course_searches TO lecturelens_analyst;
