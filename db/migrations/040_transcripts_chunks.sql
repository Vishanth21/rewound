-- 040_transcripts_chunks.sql  (owner: Member A)
-- One transcript per lecture, split into searchable chunks (with vectors),
-- plus the search log that feeds the analytics views.

CREATE TABLE transcript (
    lecture_id     integer     PRIMARY KEY REFERENCES lecture ON DELETE CASCADE,  -- 1:1 with lecture
    uploaded_by    integer     NOT NULL REFERENCES app_user,                       -- = the approver
    source_format  varchar(4)  NOT NULL CHECK (source_format IN ('srt', 'vtt', 'json')),
    raw_text       text        NOT NULL,              -- original file, kept for re-chunking
    segment_count  integer     NOT NULL CHECK (segment_count > 0),
    status         varchar(8)  NOT NULL DEFAULT 'chunked' CHECK (status IN ('chunked', 'indexed')),
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_transcript_uploader ON transcript (uploaded_by);

-- The uploader must teach the lecture's course.
CREATE FUNCTION fn_uploader_teaches_course() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1
                   FROM lecture l
                   JOIN course_instructor ci ON ci.course_id = l.course_id
                   WHERE l.lecture_id = NEW.lecture_id AND ci.instructor_id = NEW.uploaded_by) THEN
        RAISE EXCEPTION 'user % does not teach the course of lecture %', NEW.uploaded_by, NEW.lecture_id
              USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_transcript_uploader
    BEFORE INSERT OR UPDATE OF uploaded_by, lecture_id ON transcript
    FOR EACH ROW EXECUTE FUNCTION fn_uploader_teaches_course();

-- The unit that is searched and returned: ~120 words, with start/end seconds.
CREATE TABLE transcript_chunk (
    chunk_id   bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lecture_id integer      NOT NULL REFERENCES transcript ON DELETE CASCADE,
    seq_no     integer      NOT NULL CHECK (seq_no >= 1),
    start_sec  numeric(8,2) NOT NULL CHECK (start_sec >= 0),
    end_sec    numeric(8,2) NOT NULL,
    content    text         NOT NULL CHECK (btrim(content) <> ''),
    embedding  vector(384),                     -- NULL until the app has embedded it
    tsv        tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    UNIQUE (lecture_id, seq_no),
    CHECK (end_sec > start_sec)
);
-- Approximate nearest-neighbour index for cosine distance (<=>). Built incrementally,
-- so no rebuild is needed after each upload.
CREATE INDEX idx_chunk_embedding_hnsw ON transcript_chunk
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- Inverted index for keyword (full-text) search.
CREATE INDEX idx_chunk_tsv ON transcript_chunk USING gin (tsv);

-- One row per search, for analytics.
CREATE TABLE search_log (
    search_id   bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     integer      REFERENCES app_user ON DELETE SET NULL,
    query_text  varchar(300) NOT NULL CHECK (btrim(query_text) <> ''),
    mode        varchar(8)   NOT NULL DEFAULT 'semantic' CHECK (mode IN ('semantic', 'keyword')),
    searched_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_log_time ON search_log (searched_at);

-- The lectures a search surfaced (M:N between search_log and lecture).
CREATE TABLE search_hit (
    search_id  bigint  REFERENCES search_log ON DELETE CASCADE,
    lecture_id integer REFERENCES lecture    ON DELETE CASCADE,
    score      real    NOT NULL,            -- cosine distance (semantic) or ts_rank (keyword)
    is_locked  boolean NOT NULL,            -- shown as an out-of-scope disclosure
    PRIMARY KEY (search_id, lecture_id)
);
CREATE INDEX idx_search_hit_lecture ON search_hit (lecture_id);
