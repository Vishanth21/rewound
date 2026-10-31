-- important_queries.sql
-- Q1, Q3, Q5, Q9-Q12 are Member A's. Member B adds Q2, Q4, Q6, Q7, Q8 (see design plan, section 12).
-- Each block starts with "-- Qn." so db/tests/run_tests.py can execute them one by one.

-- Q1. Admin dashboard: lectures in high demand from outside students (JOIN, GROUP BY, HAVING, ORDER BY)
SELECT co.code, l.lecture_no, l.title, count(*) AS requests_30d
FROM access_request r
JOIN lecture l  ON l.lecture_id = r.lecture_id
JOIN course  co ON co.course_id = l.course_id
WHERE r.requested_at > now() - interval '30 days'
GROUP BY co.code, l.lecture_no, l.title
HAVING count(*) >= 3
ORDER BY requests_30d DESC;

-- Q3. Instructor to-do: lectures with a missing or un-indexed transcript (LEFT JOIN, COALESCE)
SELECT co.code, l.lecture_no, l.title, coalesce(t.status, 'missing') AS transcript_status
FROM lecture l
JOIN course co          ON co.course_id  = l.course_id
LEFT JOIN transcript t  ON t.lecture_id  = l.lecture_id
WHERE t.lecture_id IS NULL OR t.status <> 'indexed'
ORDER BY co.code, l.lecture_no;

-- Q5. Analytics: top 3 most-matched lectures per course, last 30 days (window function over GROUP BY)
SELECT code, title, times_matched, rnk
FROM (SELECT co.code, l.title, count(*) AS times_matched,
             rank() OVER (PARTITION BY co.code ORDER BY count(*) DESC) AS rnk
      FROM search_hit h
      JOIN search_log s USING (search_id)
      JOIN lecture    l ON l.lecture_id = h.lecture_id
      JOIN course    co ON co.course_id = l.course_id
      WHERE s.searched_at > now() - interval '30 days'
      GROUP BY co.code, l.title) ranked
WHERE rnk <= 3
ORDER BY code, rnk;

-- Q9. Recursive CTE: how many chunks cover each minute of lecture 1 (finds uncovered minutes)
WITH RECURSIVE minutes(m) AS (
    SELECT 0
    UNION ALL
    SELECT m + 1 FROM minutes
    WHERE m < (SELECT (duration_sec - 1) / 60 FROM lecture WHERE lecture_id = 1)
)
SELECT m AS minute, count(c.chunk_id) AS chunks_covering_minute
FROM minutes
LEFT JOIN transcript_chunk c
       ON c.lecture_id = 1 AND c.start_sec < (m + 1) * 60 AND c.end_sec > m * 60
GROUP BY m
ORDER BY m;

-- Q10. CTE + window function: silent gaps of more than 5 seconds between consecutive chunks
WITH ordered AS (
    SELECT lecture_id, seq_no, start_sec,
           lag(end_sec) OVER (PARTITION BY lecture_id ORDER BY seq_no) AS prev_end
    FROM transcript_chunk
)
SELECT l.lecture_no, o.seq_no, o.prev_end, o.start_sec, o.start_sec - o.prev_end AS gap_sec
FROM ordered o
JOIN lecture l ON l.lecture_id = o.lecture_id
WHERE o.start_sec - o.prev_end > 5
ORDER BY gap_sec DESC;

-- Q11. Nested + correlated subquery: lectures with more chunks than the average lecture of their course
SELECT co.code, l.lecture_no, l.title,
       (SELECT count(*) FROM transcript_chunk c WHERE c.lecture_id = l.lecture_id) AS chunks
FROM lecture l
JOIN course co ON co.course_id = l.course_id
WHERE (SELECT count(*) FROM transcript_chunk c WHERE c.lecture_id = l.lecture_id)
    > (SELECT avg(n) FROM (SELECT count(*) AS n
                           FROM transcript_chunk c2
                           JOIN lecture l2 ON l2.lecture_id = c2.lecture_id
                           WHERE l2.course_id = l.course_id
                           GROUP BY c2.lecture_id) per_lecture)
ORDER BY co.code, l.lecture_no;

-- Q12. Vector read: passages most similar to chunk 1, from other lectures ("related passages")
SELECT l.lecture_no, c2.seq_no, c2.start_sec, round((c2.embedding <=> c1.embedding)::numeric, 3) AS distance
FROM transcript_chunk c1
JOIN transcript_chunk c2 ON c2.lecture_id <> c1.lecture_id AND c2.embedding IS NOT NULL
JOIN lecture l           ON l.lecture_id = c2.lecture_id
WHERE c1.chunk_id = 1 AND c1.embedding IS NOT NULL
ORDER BY c2.embedding <=> c1.embedding
LIMIT 5;
