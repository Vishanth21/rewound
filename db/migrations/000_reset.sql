DROP VIEW IF EXISTS v_course_overview, v_course_access_demand, v_pending_by_approver,
v_request_history, v_student_access, v_course_search_activity,
v_unanswered_queries CASCADE;

DROP MATERIALIZED VIEW IF EXISTS mv_daily_course_searches;

DROP TABLE IF EXISTS search_hit, search_log, access_request, transcript_chunk, transcript,
enrollment, lecture, course_instructor, course, app_user CASCADE;

DROP TYPE IF EXISTS user_role, request_status CASCADE;

