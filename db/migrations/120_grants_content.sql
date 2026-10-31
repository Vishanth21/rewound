-- 120_grants_content.sql  (owner: Member A)
-- Least-privilege grants for the functions/procedures added by Member A after the base
-- role setup in 100_roles_rls.sql. Everything else was revoked from PUBLIC there.
GRANT EXECUTE ON FUNCTION  fn_can_manage_lecture(integer), refresh_daily_searches(),
                           update_chunk_text(bigint, text), course_lectures(integer)
    TO lecturelens_app;
GRANT EXECUTE ON PROCEDURE delete_transcript(integer)
    TO lecturelens_app;
