-- 080_search_functions.sql  (owner: Member A)
-- Role-scoped semantic + keyword search, enforced inside the database.
-- Scope always comes from accessible_lectures(user), defined in 050_access_functions.sql.

-- Semantic search. Returns up to 3 passages for each of the best p_limit lectures in scope.
-- If nothing in scope matches, returns locked "disclosure" rows instead: one per lecture,
-- with no video id, no timestamp, and a truncated excerpt.
CREATE FUNCTION search_lectures(p_query        vector(384),
                                p_limit        integer DEFAULT 10,
                                p_max_distance real    DEFAULT 0.55)
RETURNS TABLE (lecture_id integer, course_code varchar, lecture_no smallint, lecture_title varchar,
               youtube_video_id char(11), chunk_id bigint, start_sec numeric,
               snippet text, distance real, is_locked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET hnsw.ef_search = 100
SET hnsw.iterative_scan = relaxed_order
AS $$
#variable_conflict use_column
DECLARE v_user integer := current_app_user();
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'no application user set' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- 1) In scope
    RETURN QUERY
    WITH scope AS (SELECT a.lecture_id FROM accessible_lectures(v_user) a),
    hits AS (
        SELECT c.chunk_id, c.lecture_id, c.start_sec, c.content,
               (c.embedding <=> p_query)::real AS dist
        FROM transcript_chunk c
        WHERE c.embedding IS NOT NULL
          AND c.lecture_id IN (SELECT s.lecture_id FROM scope s)
        ORDER BY c.embedding <=> p_query
        LIMIT 200
    ),
    ranked AS (
        SELECT h.*,
               row_number() OVER (PARTITION BY h.lecture_id ORDER BY h.dist) AS rn,
               min(h.dist)  OVER (PARTITION BY h.lecture_id)                 AS best
        FROM hits h
        WHERE h.dist <= p_max_distance
    ),
    top_lectures AS (
        SELECT r.lecture_id, r.best FROM ranked r WHERE r.rn = 1 ORDER BY r.best LIMIT p_limit
    )
    SELECT l.lecture_id, co.code, l.lecture_no, l.title, l.youtube_video_id,
           r.chunk_id, r.start_sec, r.content, r.dist, false
    FROM ranked r
    JOIN top_lectures t ON t.lecture_id = r.lecture_id
    JOIN lecture      l ON l.lecture_id = r.lecture_id
    JOIN course      co ON co.course_id = l.course_id
    WHERE r.rn <= 3
    ORDER BY t.best, r.lecture_id, r.rn;

    IF FOUND THEN RETURN; END IF;

    -- 2) Nothing in scope: disclose out-of-scope matches, locked
    RETURN QUERY
    WITH hits AS (
        SELECT c.lecture_id, c.content, (c.embedding <=> p_query)::real AS dist
        FROM transcript_chunk c
        WHERE c.embedding IS NOT NULL
          AND c.lecture_id NOT IN (SELECT a.lecture_id FROM accessible_lectures(v_user) a)
        ORDER BY c.embedding <=> p_query
        LIMIT 200
    ),
    best AS (
        SELECT DISTINCT ON (h.lecture_id) h.*
        FROM hits h
        WHERE h.dist <= p_max_distance
        ORDER BY h.lecture_id, h.dist
    )
    SELECT l.lecture_id, co.code, l.lecture_no, l.title, NULL::char(11),
           NULL::bigint, NULL::numeric, left(b.content, 160) || ' ...', b.dist, true
    FROM best b
    JOIN lecture l  ON l.lecture_id = b.lecture_id
    JOIN course  co ON co.course_id = l.course_id
    ORDER BY b.dist
    LIMIT p_limit;
END $$;

-- Keyword (exact-term) search over the same chunks, same scope, using full-text search.
-- Matches are wrapped in [[[ ]]] (not HTML) so the UI can highlight them without ever injecting markup.
CREATE FUNCTION search_lectures_keyword(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE (lecture_id integer, course_code varchar, lecture_no smallint, lecture_title varchar,
               youtube_video_id char(11), start_sec numeric, snippet text, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH q AS (SELECT websearch_to_tsquery('english', p_query) AS tsq),
    hits AS (
        SELECT DISTINCT ON (c.lecture_id)
               c.lecture_id, c.start_sec, c.content, ts_rank(c.tsv, q.tsq) AS rank, q.tsq
        FROM transcript_chunk c, q
        WHERE c.tsv @@ q.tsq
          AND c.lecture_id IN (SELECT a.lecture_id FROM accessible_lectures(current_app_user()) a)
        ORDER BY c.lecture_id, ts_rank(c.tsv, q.tsq) DESC
    )
    SELECT l.lecture_id, co.code, l.lecture_no, l.title, l.youtube_video_id, h.start_sec,
           ts_headline('english', h.content, h.tsq, 'MaxFragments=1, MaxWords=30, StartSel=[[[, StopSel=]]]'), h.rank
    FROM hits h
    JOIN lecture l  ON l.lecture_id = h.lecture_id
    JOIN course  co ON co.course_id = l.course_id
    ORDER BY h.rank DESC
    LIMIT p_limit
$$;

-- Full transcript + video id for the lecture page; refuses if the caller has no access.
CREATE FUNCTION get_lecture(p_lecture_id integer)
RETURNS TABLE (lecture_title varchar, course_code varchar, youtube_video_id char(11),
               chunk_id bigint, seq_no integer, start_sec numeric, end_sec numeric, content text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM accessible_lectures(current_app_user()) a
                   WHERE a.lecture_id = p_lecture_id) THEN
        RAISE EXCEPTION 'no access to lecture %', p_lecture_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN QUERY
    SELECT l.title, co.code, l.youtube_video_id, c.chunk_id, c.seq_no, c.start_sec, c.end_sec, c.content
    FROM lecture l
    JOIN course co ON co.course_id = l.course_id
    JOIN transcript_chunk c ON c.lecture_id = l.lecture_id
    WHERE l.lecture_id = p_lecture_id
    ORDER BY c.seq_no;
END $$;

-- Record a search and the lectures it surfaced (feeds the analytics views).
--   p_hits: [{"lecture_id":4,"score":0.31,"locked":false}, ...]
CREATE FUNCTION log_search(p_query text, p_mode varchar, p_hits jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
    INSERT INTO search_log (user_id, query_text, mode)
    VALUES (current_app_user(), left(btrim(p_query), 300), p_mode)
    RETURNING search_id INTO v_id;

    INSERT INTO search_hit (search_id, lecture_id, score, is_locked)
    SELECT v_id, (h ->> 'lecture_id')::integer, (h ->> 'score')::real, (h ->> 'locked')::boolean
    FROM jsonb_array_elements(coalesce(p_hits, '[]'::jsonb)) AS h
    ON CONFLICT DO NOTHING;
    RETURN v_id;
END $$;

-- Video id for the server-side thumbnail proxy (/api/lectures/:id/thumbnail). Only the Next.js
-- server sees the id; the browser just receives image bytes, so a locked result can show a
-- thumbnail without revealing the video link.
CREATE FUNCTION get_thumbnail_source(p_lecture_id integer)
RETURNS char(11) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT youtube_video_id FROM lecture WHERE lecture_id = p_lecture_id
$$;
