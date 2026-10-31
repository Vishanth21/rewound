-- 20_courses_lectures.sql  (owner: Member A)
-- Demo courses, their instructors and lectures. Run by `npm run db:seed` AFTER the users exist
-- (10_users, Member B). Courses go through create_course() so the "course needs an instructor"
-- rule and the admin-only check are exercised exactly as the app does it.
--
-- youtube_video_id values are PLACEHOLDERS in the right format. Replace them with the ids of the
-- real unlisted lecture videos before the demo (UPDATE lecture SET youtube_video_id = ... ).
-- Transcripts for these lectures live in db/seed/transcripts/<CODE>-<NN>.srt|vtt.

SELECT set_config('lecturelens.user_id',
                  (SELECT user_id FROM app_user WHERE lower(email) = 'admin@pes.edu')::text, false);

-- (CALL does not accept subqueries as arguments, so the instructor ids are looked up first)
DO $$
DECLARE
    uid_of    jsonb := (SELECT jsonb_object_agg(lower(email), user_id) FROM app_user);
    course_id integer;   -- receives create_course's INOUT p_course_id
BEGIN
    CALL create_course('CS301', 'Database Management Systems', 5, ARRAY[(uid_of ->> 'rao@pes.edu')::int],   course_id);
    CALL create_course('CS302', 'Operating Systems',           5, ARRAY[(uid_of ->> 'iyer@pes.edu')::int],  course_id);
    CALL create_course('CS303', 'Machine Learning',            6, ARRAY[(uid_of ->> 'menon@pes.edu')::int], course_id);
END $$;

INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, delivered_on, description, created_by)
SELECT co.course_id, v.lecture_no, v.title, v.video, v.duration_sec, v.delivered_on::date, v.description, ci.instructor_id
FROM (VALUES
    ('CS301', 1, 'Transactions and ACID',             'CS301demo01', 300, '2026-08-11', 'Atomicity, consistency, isolation, durability; commit and rollback.'),
    ('CS301', 2, 'Concurrency Control and Locking',   'CS301demo02', 305, '2026-08-18', 'Schedules, serializability, two-phase locking, deadlocks in a DBMS.'),
    ('CS301', 3, 'Normalization: 1NF to BCNF',        'CS301demo03', 315, '2026-08-25', 'Functional dependencies, update anomalies and the normal forms.'),
    ('CS302', 1, 'Processes and CPU Scheduling',      'CS302demo01', 300, '2026-08-12', 'Process states, context switches, FCFS, SJF and round robin.'),
    ('CS302', 2, 'Deadlocks',                         'CS302demo02', 320, '2026-08-19', 'Coffman conditions, prevention, avoidance with the banker''s algorithm, detection.'),
    ('CS302', 3, 'Virtual Memory and Paging',         'CS302demo03', 310, '2026-08-26', 'Page tables, TLBs, page faults and replacement policies.'),
    ('CS303', 1, 'Linear Regression and Gradient Descent', 'CS303demo01', 300, '2026-08-13', 'Least squares, the loss surface and learning rates.'),
    ('CS303', 2, 'Overfitting and Regularization',    'CS303demo02', 285, '2026-08-20', 'Bias and variance, validation sets, L1/L2 penalties.'),
    ('CS303', 3, 'Evaluating Classifiers',            'CS303demo03', 285, '2026-08-27', 'Accuracy, precision, recall, F1 and ROC curves.')
) AS v(code, lecture_no, title, video, duration_sec, delivered_on, description)
JOIN course co            ON co.code = v.code
JOIN course_instructor ci ON ci.course_id = co.course_id;
