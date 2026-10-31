-- 020_courses_lectures.sql  (owner: Member A)
-- Courses, who teaches them, and the lectures inside a course.

CREATE TABLE course (
    course_id  integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       varchar(12) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,12}$'),
    title      varchar(150) NOT NULL CHECK (btrim(title) <> ''),
    semester   smallint    NOT NULL CHECK (semester BETWEEN 1 AND 8),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- M:N between course and instructor. A course always has >= 1 row here (deferred trigger below).
CREATE TABLE course_instructor (
    course_id     integer REFERENCES course   ON DELETE CASCADE,
    instructor_id integer REFERENCES app_user ON DELETE RESTRICT,
    PRIMARY KEY (course_id, instructor_id)
);
CREATE INDEX idx_course_instructor_user ON course_instructor (instructor_id);

-- fn_require_role() is the generic role-check trigger function defined in 010_users.sql.
CREATE TRIGGER trg_course_instructor_role
    BEFORE INSERT OR UPDATE ON course_instructor
    FOR EACH ROW EXECUTE FUNCTION fn_require_role('instructor_id', 'instructor');

-- "A course always has at least one instructor".
-- Checked at COMMIT (deferred) so the course row and its instructor rows can be
-- inserted in either order inside one transaction (see create_course in 060).
CREATE FUNCTION fn_course_has_instructor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_course integer;
BEGIN
    IF TG_TABLE_NAME = 'course' THEN v_course := NEW.course_id;
    ELSE                             v_course := OLD.course_id;
    END IF;
    IF EXISTS (SELECT 1 FROM course WHERE course_id = v_course)            -- course still exists
       AND NOT EXISTS (SELECT 1 FROM course_instructor WHERE course_id = v_course) THEN
        RAISE EXCEPTION 'course % must have at least one instructor', v_course
              USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_course_needs_instructor
    AFTER INSERT ON course DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_course_has_instructor();
CREATE CONSTRAINT TRIGGER trg_keep_last_instructor
    AFTER DELETE OR UPDATE ON course_instructor DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_course_has_instructor();

CREATE TABLE lecture (
    lecture_id      integer      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id       integer      NOT NULL REFERENCES course ON DELETE CASCADE,
    lecture_no      smallint     NOT NULL CHECK (lecture_no > 0),
    title           varchar(200) NOT NULL CHECK (btrim(title) <> ''),
    youtube_video_id char(11)    NOT NULL CHECK (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
    duration_sec    integer      NOT NULL CHECK (duration_sec > 0),
    delivered_on    date,
    created_by      integer      NOT NULL REFERENCES app_user,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (course_id, lecture_no)
);
-- (course_id, lecture_no) UNIQUE already gives an index on course_id.
