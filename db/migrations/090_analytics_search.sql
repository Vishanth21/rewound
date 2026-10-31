-- 090_analytics_search.sql  (owner: Member A)
-- Course-wise analytics over content and search activity.

-- Per course: content volume and indexing progress.
CREATE VIEW v_course_overview AS
SELECT co.course_id, co.code, co.title, co.semester,
       count(l.lecture_id)                                           AS lectures,
       count(t.lecture_id) FILTER (WHERE t.status = 'indexed')       AS indexed_lectures,
       round(coalesce(sum(l.duration_sec), 0) / 3600.0, 1)           AS video_hours,
       (SELECT count(*) FROM enrollment e WHERE e.course_id = co.course_id) AS enrolled_students,
       (SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name)
          FROM course_instructor ci JOIN app_user u ON u.user_id = ci.instructor_id
         WHERE ci.course_id = co.course_id)                          AS instructors
FROM course co
LEFT JOIN lecture    l ON l.course_id  = co.course_id
LEFT JOIN transcript t ON t.lecture_id = l.lecture_id
GROUP BY co.course_id, co.code, co.title, co.semester;

-- Per course, last 30 days: how often its lectures surface in searches, and how often locked.
CREATE VIEW v_course_search_activity AS
SELECT co.code, co.title,
       count(DISTINCT h.search_id)                  AS searches_matched,
       count(DISTINCT s.user_id)                    AS distinct_searchers,
       count(*) FILTER (WHERE NOT h.is_locked)      AS in_scope_hits,
       count(*) FILTER (WHERE h.is_locked)          AS locked_hits
FROM search_hit h
JOIN search_log s USING (search_id)
JOIN lecture    l ON l.lecture_id = h.lecture_id
JOIN course    co ON co.course_id = l.course_id
WHERE s.searched_at > now() - interval '30 days'
GROUP BY co.course_id, co.code, co.title;

-- Content gaps: queries asked at least twice that matched nothing at all.
CREATE VIEW v_unanswered_queries AS
SELECT lower(btrim(s.query_text)) AS query, count(*) AS times_asked, max(s.searched_at) AS last_asked
FROM search_log s
WHERE NOT EXISTS (SELECT 1 FROM search_hit h WHERE h.search_id = s.search_id)
GROUP BY lower(btrim(s.query_text))
HAVING count(*) >= 2;

-- Daily searches per course, pre-aggregated for the dashboard trend chart.
CREATE MATERIALIZED VIEW mv_daily_course_searches AS
SELECT l.course_id, date_trunc('day', s.searched_at)::date AS day, count(DISTINCT s.search_id) AS searches
FROM search_log s
JOIN search_hit h USING (search_id)
JOIN lecture    l ON l.lecture_id = h.lecture_id
GROUP BY l.course_id, date_trunc('day', s.searched_at)::date;
CREATE UNIQUE INDEX uq_mv_daily_course_searches ON mv_daily_course_searches (course_id, day);

-- A materialized view can only be refreshed by its owner. The app role is not the owner,
-- so it calls this SECURITY DEFINER wrapper instead.
CREATE FUNCTION refresh_daily_searches() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_course_searches
$$;
