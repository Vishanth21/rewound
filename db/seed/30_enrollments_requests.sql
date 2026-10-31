-- 30_enrollments_requests.sql  (owner: Member B)
-- Demo enrollments. Run by `npm run db:seed` AFTER 20_courses_lectures.sql, so the courses exist.
--
-- The access requests are NOT here on purpose. fn_request_before_insert() refuses a request for a
-- lecture that has no transcript (the transcript is what names the approver), and transcripts are
-- ingested in step 3 of scripts/seed.ts -- after the seed SQL runs. So the demo requests and their
-- decisions are created in step 4 of scripts/seed.ts, through request_access() and decide_request(),
-- exactly as the app does it.

INSERT INTO enrollment (student_id, course_id)
SELECT u.user_id, co.course_id
FROM (VALUES
    ('asha@pes.edu',   'CS301'),   -- own course: can already reach its lectures
    ('ben@pes.edu',    'CS302'),
    ('chitra@pes.edu', 'CS303'),
    ('asha@pes.edu',   'CS302'),   -- cross-course: requests CS302 lectures (Iyer's inbox)
    ('ben@pes.edu',    'CS303')    -- cross-course: requests CS303 lectures (Menon's inbox)
) AS v(email, code)
JOIN app_user u ON lower(u.email) = v.email
JOIN course   co ON co.code = v.code;