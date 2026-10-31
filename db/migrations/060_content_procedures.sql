-- 060_content_procedures.sql  (owner: Member A)
-- Course creation, transcript chunking/ingestion, and the vector create/read/update/delete
-- operations. These rely on current_app_user() from 050_access_functions.sql.

-- Helper: may the current user manage this lecture's content? (admin, or an instructor of its course)
CREATE FUNCTION fn_can_manage_lecture(p_lecture integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM app_user u
                   WHERE u.user_id = current_app_user() AND u.role = 'admin')
        OR EXISTS (SELECT 1
                   FROM lecture l
                   JOIN course_instructor ci ON ci.course_id = l.course_id
                   WHERE l.lecture_id = p_lecture AND ci.instructor_id = current_app_user())
$$;

-- Admin creates a course together with its instructors in ONE transaction.
-- The deferred "needs an instructor" trigger is satisfied because both inserts commit together.
CREATE PROCEDURE create_course(p_code varchar, p_title varchar, p_semester integer,
                               p_instructor_ids integer[], INOUT p_course_id integer DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF (SELECT role FROM app_user WHERE user_id = current_app_user()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'only an admin may create a course' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF coalesce(cardinality(p_instructor_ids), 0) = 0 THEN
        RAISE EXCEPTION 'a course needs at least one instructor' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO course (code, title, semester)
    VALUES (upper(btrim(p_code)), btrim(p_title), p_semester)
    RETURNING course_id INTO p_course_id;
    INSERT INTO course_instructor (course_id, instructor_id)
    SELECT p_course_id, unnest(p_instructor_ids);
END $$;

-- Chunk and ingest a transcript (phase 1 of ingestion; embeddings are filled in by phase 2).
--   p_segments: the parsed SRT/VTT cues, e.g. [{"start":0.0,"end":4.2,"text":"..."}, ...]
-- Consecutive cues are packed into chunks of ~p_target_words words (or p_max_seconds of
-- video, whichever comes first). With p_overlap the last cue of a chunk is repeated as the
-- first cue of the next one, so an idea that straddles a boundary is still found.
-- Re-uploading replaces the previous transcript and all its chunks atomically.
CREATE PROCEDURE ingest_transcript(p_lecture_id   integer,
                                   p_format       varchar,
                                   p_raw_text     text,
                                   p_segments     jsonb,
                                   p_target_words integer DEFAULT 120,
                                   p_max_seconds  numeric DEFAULT 60,
                                   p_overlap      boolean DEFAULT true)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    seg        record;
    v_words    integer;
    buf_text   text    := '';
    buf_words  integer := 0;
    buf_start  numeric;
    buf_end    numeric;
    buf_fresh  boolean := false;   -- buffer holds at least one cue not yet written
    prev_start numeric := 0;
    v_seq      integer := 0;
BEGIN
    IF jsonb_typeof(p_segments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_segments) = 0 THEN
        RAISE EXCEPTION 'segments must be a non-empty JSON array' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    DELETE FROM transcript WHERE lecture_id = p_lecture_id;          -- cascades to old chunks
    INSERT INTO transcript (lecture_id, uploaded_by, source_format, raw_text, segment_count)
    VALUES (p_lecture_id, current_app_user(), p_format, p_raw_text, jsonb_array_length(p_segments));
    -- (trg_transcript_uploader rejects the insert if the caller does not teach this course)

    FOR seg IN
        SELECT (s ->> 'start')::numeric AS s_start,
               (s ->> 'end')::numeric   AS s_end,
               btrim(s ->> 'text')      AS s_text,
               ord
        FROM jsonb_array_elements(p_segments) WITH ORDINALITY AS t(s, ord)
        ORDER BY ord
    LOOP
        IF seg.s_start IS NULL OR seg.s_end IS NULL
           OR seg.s_end <= seg.s_start OR seg.s_start < prev_start THEN
            RAISE EXCEPTION 'segment % has missing or out-of-order timestamps', seg.ord
                  USING ERRCODE = 'invalid_parameter_value';
        END IF;
        prev_start := seg.s_start;
        CONTINUE WHEN coalesce(seg.s_text, '') = '';

        v_words := cardinality(regexp_split_to_array(seg.s_text, '\s+'));
        IF buf_text = '' THEN buf_start := seg.s_start; END IF;
        buf_text  := CASE WHEN buf_text = '' THEN seg.s_text ELSE buf_text || ' ' || seg.s_text END;
        buf_words := buf_words + v_words;
        buf_end   := seg.s_end;
        buf_fresh := true;

        IF buf_words >= p_target_words OR buf_end - buf_start >= p_max_seconds THEN
            v_seq := v_seq + 1;
            INSERT INTO transcript_chunk (lecture_id, seq_no, start_sec, end_sec, content)
            VALUES (p_lecture_id, v_seq, buf_start, buf_end, buf_text);
            buf_fresh := false;
            IF p_overlap THEN          -- seed the next chunk with this cue
                buf_text := seg.s_text;  buf_words := v_words;  buf_start := seg.s_start;
            ELSE
                buf_text := '';          buf_words := 0;
            END IF;
        END IF;
    END LOOP;

    IF buf_fresh THEN                  -- flush the tail
        v_seq := v_seq + 1;
        INSERT INTO transcript_chunk (lecture_id, seq_no, start_sec, end_sec, content)
        VALUES (p_lecture_id, v_seq, buf_start, buf_end, buf_text);
    END IF;

    IF v_seq = 0 THEN
        RAISE EXCEPTION 'transcript for lecture % produced no chunks', p_lecture_id
              USING ERRCODE = 'invalid_parameter_value';
    END IF;
END $$;

-- Vector CREATE / UPDATE (phase 2 of ingestion): the app embeds each chunk and writes the
-- vectors back.   p_vectors: [{"seq":1,"v":[0.012,-0.034, ... 384 floats]}, ...]
-- Calling it again with new vectors re-embeds (UPDATE). The transcript becomes 'indexed'
-- once no chunk is left without an embedding.
CREATE PROCEDURE set_chunk_embeddings(p_lecture_id integer, p_vectors jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows integer;
BEGIN
    IF NOT fn_can_manage_lecture(p_lecture_id) THEN
        RAISE EXCEPTION 'not allowed to modify lecture %', p_lecture_id
              USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF jsonb_typeof(p_vectors) IS DISTINCT FROM 'array' OR jsonb_array_length(p_vectors) = 0 THEN
        RAISE EXCEPTION 'vectors must be a non-empty JSON array' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    UPDATE transcript_chunk c
       SET embedding = (e ->> 'v')::vector(384)
      FROM jsonb_array_elements(p_vectors) AS e
     WHERE c.lecture_id = p_lecture_id
       AND c.seq_no = (e ->> 'seq')::integer;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> jsonb_array_length(p_vectors) THEN
        RAISE EXCEPTION 'embedding count mismatch: % vectors, % chunks updated',
              jsonb_array_length(p_vectors), v_rows USING ERRCODE = 'invalid_parameter_value';
    END IF;

    UPDATE transcript t
       SET status = 'indexed'
     WHERE t.lecture_id = p_lecture_id
       AND NOT EXISTS (SELECT 1 FROM transcript_chunk c
                       WHERE c.lecture_id = p_lecture_id AND c.embedding IS NULL);
END $$;

-- Vector UPDATE: correct a mis-transcribed passage. Its old vector is now wrong, so it is
-- cleared and the transcript goes back to 'chunked' until the app re-embeds that chunk.
-- Returns which lecture/chunk to re-embed.
CREATE FUNCTION update_chunk_text(p_chunk_id bigint, p_content text)
RETURNS TABLE (lecture_id integer, seq_no integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_lecture integer; v_seq integer;
BEGIN
    SELECT c.lecture_id, c.seq_no INTO v_lecture, v_seq FROM transcript_chunk c WHERE c.chunk_id = p_chunk_id;
    IF v_lecture IS NULL THEN
        RAISE EXCEPTION 'chunk % not found', p_chunk_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT fn_can_manage_lecture(v_lecture) THEN
        RAISE EXCEPTION 'not allowed to modify lecture %', v_lecture USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF btrim(coalesce(p_content, '')) = '' THEN
        RAISE EXCEPTION 'passage text cannot be blank' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE transcript_chunk c SET content = btrim(p_content), embedding = NULL WHERE c.chunk_id = p_chunk_id;
    UPDATE transcript t SET status = 'chunked' WHERE t.lecture_id = v_lecture;
    RETURN QUERY SELECT v_lecture, v_seq;
END $$;

-- Vector DELETE: remove a lecture's transcript; ON DELETE CASCADE removes every chunk and
-- vector with it, so the lecture stops appearing in search immediately.
CREATE PROCEDURE delete_transcript(p_lecture_id integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT fn_can_manage_lecture(p_lecture_id) THEN
        RAISE EXCEPTION 'not allowed to modify lecture %', p_lecture_id
              USING ERRCODE = 'insufficient_privilege';
    END IF;
    DELETE FROM transcript WHERE lecture_id = p_lecture_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lecture % has no transcript', p_lecture_id USING ERRCODE = 'no_data_found';
    END IF;
END $$;
