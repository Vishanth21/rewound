#!/usr/bin/env python3
"""
LectureLens database test suite (Member A's checks).

Starts a throwaway PostgreSQL 16 + pgvector (bundled by the `pgserver` pip package),
applies every migration in db/migrations (plus stand-ins from db/tests/stubs for any of
Member B's migrations that are not in the repo yet), drops everything with 000_reset.sql,
re-applies, then exercises every business rule through the SAME role (lecturelens_app)
and functions the web app uses. Embeddings are synthetic 384-d vectors so results are
deterministic and no model download is needed.

    python -m pip install pgserver psycopg2-binary
    python db/tests/run_tests.py

Last line: "<passed>/<total> passed". Details go to db/tests/test_results.json.
"""
import json
import math
import random
import re
import shutil
import sys
import tempfile
from pathlib import Path

import psycopg2
import pgserver

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "db" / "migrations"
STUBS = ROOT / "db" / "tests" / "stubs"
QUERIES = ROOT / "db" / "queries" / "important_queries.sql"
RESULTS_FILE = ROOT / "db" / "tests" / "test_results.json"

APP_PW, ANALYST_PW = "test-app-pw", "test-analyst-pw"
BCRYPT_HASH = "$2b$12$" + "a" * 53     # shape-valid bcrypt hash (the CHECK only tests the shape)


# ----------------------------------------------------------------------------- helpers
def mig_number(path):
    return int(path.name.split("_", 1)[0])


def migration_files():
    """Real migrations, plus a stub for every number that has no real file yet."""
    real = sorted(MIGRATIONS.glob("*.sql"), key=lambda p: (mig_number(p), p.name))
    have = {mig_number(p) for p in real}
    used_stubs = [s for s in sorted(STUBS.glob("*.sql")) if mig_number(s) not in have]
    return sorted(real + used_stubs, key=lambda p: (mig_number(p), p.name)), used_stubs


def prepare_sql(text, pgvector_version):
    text = text.replace(":'app_pw'", "'%s'" % APP_PW).replace(":'analyst_pw'", "'%s'" % ANALYST_PW)
    if pgvector_version < (0, 8):   # hnsw.iterative_scan only exists in pgvector >= 0.8
        text = re.sub(r"^\s*SET hnsw\.iterative_scan.*$", "", text, flags=re.M)
    return text


def unit(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def topic_vec(topic, seed=0, noise=0.05):
    """Synthetic embedding: a strong direction per topic plus a little noise."""
    rnd = random.Random(topic * 1000 + seed)
    v = [rnd.gauss(0, noise) for _ in range(384)]
    for j in range(topic * 8, topic * 8 + 8):
        v[j] += 1.0
    return unit(v)


def vlit(v):
    return "[" + ",".join("%.6f" % x for x in v) + "]"


def segments(n=20, gap=10, words=30, special=None):
    """n cues of `words` words each, `gap` seconds apart. special={cue_index: 'term'}."""
    out = []
    for i in range(n):
        ws = ["w%dx%d" % (i, j) for j in range(words)]
        if special and i in special:
            ws[4] = special[i]
        out.append({"start": i * gap, "end": i * gap + gap - 0.5, "text": " ".join(ws)})
    return out


# ----------------------------------------------------------------------------- harness
RESULTS = []
cur = None


def check(cid, area, desc, owner="A"):
    def deco(fn):
        try:
            observed = fn()
            RESULTS.append(dict(id=cid, area=area, check=desc, observed=str(observed), result="PASS", owner=owner))
        except Exception as e:  # noqa: BLE001 - any failure is a failed check
            try:
                cur.execute("ROLLBACK")
            except Exception:  # noqa: BLE001
                pass
            RESULTS.append(dict(id=cid, area=area, check=desc, observed="%s: %s" % (type(e).__name__, str(e).strip().splitlines()[0] if str(e).strip() else ""),
                                result="FAIL", owner=owner))
        finally:
            as_owner()
        return fn
    return deco


def as_user(uid, role="lecturelens_app"):
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('lecturelens.user_id', %s, false)", (str(uid),))
    cur.execute("SET ROLE " + role)


def as_owner():
    try:
        cur.execute("RESET ROLE")
        cur.execute("SELECT set_config('lecturelens.user_id', '', false)")
    except Exception:  # noqa: BLE001
        cur.execute("ROLLBACK")
        cur.execute("RESET ROLE")


def first_line(e):
    return str(e).strip().splitlines()[0]


def rejects(sql, params=None, expect=None):
    """The statement must fail. Returns the error text (shown as 'observed')."""
    try:
        cur.execute(sql, params)
    except psycopg2.Error as e:
        msg = first_line(e)
        if expect and expect.lower() not in str(e).lower():
            raise AssertionError("rejected for the wrong reason: " + msg)
        return msg
    raise AssertionError("statement was NOT rejected")


def commit_rejects(statements, expect):
    """Run statements in a transaction; the failure must happen at COMMIT (deferred trigger)."""
    cur.execute("BEGIN")
    try:
        for s, p in statements:
            cur.execute(s, p)
        try:
            cur.execute("COMMIT")
        except psycopg2.Error as e:
            if expect.lower() not in str(e).lower():
                raise AssertionError("rejected for the wrong reason: " + first_line(e))
            return first_line(e)
        raise AssertionError("COMMIT was NOT rejected")
    finally:
        try:
            cur.execute("ROLLBACK")
        except psycopg2.Error:
            pass


def one(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchone()[0]


def rows(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchall()


# ----------------------------------------------------------------------------- main
def main():
    global cur
    data_dir = tempfile.mkdtemp(prefix="lecturelens_pg_")
    server = pgserver.get_server(data_dir, cleanup_mode="delete")
    conn = psycopg2.connect(server.get_uri())
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
    pgv = one("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    pgv_t = tuple(int(x) for x in pgv.split(".")[:2])
    print("PostgreSQL %s | pgvector %s" % (one("SHOW server_version"), pgv))

    files, used_stubs = migration_files()
    if used_stubs:
        print("NOTE: using stand-ins for Member B migrations not yet in the repo: " + ", ".join(s.name for s in used_stubs))

    def apply_all():
        for f in files:
            sql = prepare_sql(f.read_text(encoding="utf-8"), pgv_t)
            try:
                cur.execute(sql)
            except psycopg2.Error as e:
                print("FAILED applying %s: %s" % (f.name, first_line(e)))
                raise

    apply_all()
    n_tables = one("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")

    # ---- reset / re-apply: proves the DROP script works and migrations are repeatable
    reset = next((f for f in files if f.name.startswith("000_")), None)
    if reset:
        cur.execute(prepare_sql(reset.read_text(encoding="utf-8"), pgv_t))
        left_tables = one("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
        left_routines = one("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
                                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')""")
        cur.execute("""
            DO $$ DECLARE r record; BEGIN
              FOR r IN SELECT p.oid::regprocedure AS sig, p.prokind
                         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
                          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
              LOOP EXECUTE format('DROP %s %s CASCADE',
                                  CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.sig);
              END LOOP; END $$;
            DROP OWNED BY lecturelens_app, lecturelens_analyst;
            DROP ROLE lecturelens_app, lecturelens_analyst;""")
        apply_all()
        RESULTS.append(dict(id="R01", area="Migrations", owner="B",
                            check="000_reset.sql drops every table, view and type; migrations re-apply cleanly",
                            observed="%d tables before, %d after reset; re-applied OK%s" % (
                                n_tables, left_tables,
                                "" if left_routines == 0 else
                                " (NOTE: 000_reset.sql leaves %d functions/procedures behind; the runner dropped them)" % left_routines),
                            result="PASS" if left_tables == 0 else "FAIL"))

    # ---- fixtures: 1 admin, 2 instructors, 2 students (inserted as the schema owner)
    for email, name, role in [("admin@pes.edu", "Admin", "admin"), ("rao@pes.edu", "Prof Rao", "instructor"),
                              ("iyer@pes.edu", "Prof Iyer", "instructor"), ("asha@pes.edu", "Asha", "student"),
                              ("ben@pes.edu", "Ben", "student")]:
        cur.execute("INSERT INTO app_user (email, full_name, password_hash, role) VALUES (%s,%s,%s,%s)",
                    (email, name, BCRYPT_HASH, role))
    U = {e.split("@")[0]: i for i, e in rows("SELECT user_id, email FROM app_user")}
    state = {}

    # ===== T01-T04: courses, instructors, lectures
    @check("T01", "Integrity", "Course inserted with no instructor is rejected at COMMIT")
    def _():
        return commit_rejects([("INSERT INTO course (code, title, semester) VALUES ('CS999','No teacher',3)", None)],
                              "must have at least one instructor")

    @check("T02", "Procedure", "create_course() creates course + instructors atomically (admin only)")
    def _():
        as_user(U["admin"])
        cur.execute("CALL create_course('cs301', 'Database Systems', 5, %s, NULL)", ([U["rao"]],))
        state["c1"] = cur.fetchone()[0]
        cur.execute("CALL create_course('CS302', 'Operating Systems', 5, %s, NULL)", ([U["iyer"]],))
        state["c2"] = cur.fetchone()[0]
        as_owner()
        assert one("SELECT code FROM course WHERE course_id = %s", (state["c1"],)) == "CS301"
        return "ok, course_ids %s and %s (code upper-cased)" % (state["c1"], state["c2"])

    # lectures and enrolments used by the later checks
    as_user(U["rao"])
    cur.execute("INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, created_by) "
                "VALUES (%s, 1, 'Transactions and Locking', 'dQw4w9WgXcQ', 1800, %s) RETURNING lecture_id",
                (state["c1"], U["rao"]))
    state["l1"] = cur.fetchone()[0]
    as_user(U["iyer"])
    cur.execute("INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, created_by) "
                "VALUES (%s, 1, 'Deadlock Prevention', 'abcdefghijk', 2400, %s) RETURNING lecture_id",
                (state["c2"], U["iyer"]))
    state["l2"] = cur.fetchone()[0]
    as_owner()
    cur.execute("INSERT INTO enrollment (student_id, course_id) VALUES (%s,%s),(%s,%s)",
                (U["asha"], state["c1"], U["ben"], state["c2"]))

    @check("T03", "Integrity", "Enrolling an instructor as a student is rejected")
    def _():
        return rejects("INSERT INTO enrollment (student_id, course_id) VALUES (%s,%s)", (U["rao"], state["c1"]), "must be a student")

    @check("T04", "Integrity", "Instructor who does not teach the course cannot upload its transcript")
    def _():
        as_user(U["iyer"])
        return rejects("CALL ingest_transcript(%s, 'srt', 'raw', %s::jsonb)",
                       (state["l1"], json.dumps(segments())), "does not teach")

    # ===== T05-T09: ingestion
    @check("T05", "Procedure", "ingest_transcript() chunks 20 cues (30 words each) into ~120-word overlapping chunks")
    def _():
        as_user(U["rao"])
        cur.execute("CALL ingest_transcript(%s, 'srt', 'raw text', %s::jsonb)",
                    (state["l1"], json.dumps(segments(special={3: "serializability"}))))
        as_owner()
        n, a, b = rows("SELECT count(*), min(start_sec), max(end_sec) FROM transcript_chunk WHERE lecture_id = %s", (state["l1"],))[0]
        assert n == 7 and float(a) == 0.0 and float(b) == 199.5, (n, a, b)
        return "chunks=%d, start=%s, end=%s" % (n, a, b)

    @check("T06", "Procedure", "ingest_transcript() for the second course")
    def _():
        as_user(U["iyer"])
        cur.execute("CALL ingest_transcript(%s, 'srt', 'raw text', %s::jsonb)",
                    (state["l2"], json.dumps(segments(special={5: "deadlock"}))))
        as_owner()
        n = one("SELECT count(*) FROM transcript_chunk WHERE lecture_id = %s", (state["l2"],))
        assert n == 7
        return "chunks=%d" % n

    @check("T07", "Validation", "Out-of-order cue timestamps are rejected")
    def _():
        bad = segments(5)
        bad[2]["start"], bad[2]["end"] = 1, 2
        as_user(U["rao"])
        return rejects("CALL ingest_transcript(%s, 'srt', 'raw', %s::jsonb)", (state["l1"], json.dumps(bad)), "out-of-order")

    def embed_lecture(lecture_id, uid, topics):
        as_user(uid)
        vecs = [{"seq": i + 1, "v": topic_vec(t, seed=i + 1)} for i, t in enumerate(topics)]
        cur.execute("CALL set_chunk_embeddings(%s, %s::jsonb)", (lecture_id, json.dumps(vecs)))
        as_owner()
        return one("SELECT status FROM transcript WHERE lecture_id = %s", (lecture_id,))

    L1_TOPICS = [0, 0, 0, 1, 0, 1, 1]       # locking x4, normalisation x3
    L2_TOPICS = [2] * 7                      # deadlock x7

    @check("T08", "Procedure", "set_chunk_embeddings() stores vectors and marks the transcript indexed")
    def _():
        s = embed_lecture(state["l1"], U["rao"], L1_TOPICS)
        assert s == "indexed"
        return "transcript.status=" + s

    @check("T09", "Procedure", "Embeddings for the second lecture")
    def _():
        s = embed_lecture(state["l2"], U["iyer"], L2_TOPICS)
        assert s == "indexed"
        return "transcript.status=" + s

    # ===== T10-T12: role-scoped semantic search
    q_locking = vlit(topic_vec(0, seed=99))
    q_deadlock = vlit(topic_vec(2, seed=99))

    @check("T10", "Search/RBAC", "Enrolled student: in-scope results, with timestamp and video id")
    def _():
        as_user(U["asha"])
        r = rows("SELECT lecture_id, youtube_video_id, start_sec, distance, is_locked FROM search_lectures(%s::vector, 10)", (q_locking,))
        assert len(r) == 3 and {x[0] for x in r} == {state["l1"]} and not any(x[4] for x in r)
        assert all(x[1] == "dQw4w9WgXcQ" and x[2] is not None for x in r)
        return "%d rows from %d lecture(s); is_locked=False; video_id=%s; best distance=%.3f" % (len(r), 1, r[0][1], min(x[3] for x in r))

    @check("T11", "Search/RBAC", "Same student, out-of-scope topic: locked row, no video id, no timestamp")
    def _():
        as_user(U["asha"])
        r = rows("SELECT lecture_id, youtube_video_id, start_sec, snippet, distance, is_locked FROM search_lectures(%s::vector, 10)", (q_deadlock,))
        assert len(r) == 1 and r[0][5] is True and r[0][1] is None and r[0][2] is None
        assert r[0][3].endswith("...")
        return "%d rows from 1 lecture(s); is_locked=True; video_id=hidden; best distance=%.3f" % (len(r), r[0][4])

    @check("T12", "Search/RBAC", "Admin searches everything (in scope)")
    def _():
        as_user(U["admin"])
        r = rows("SELECT lecture_id, youtube_video_id, distance, is_locked FROM search_lectures(%s::vector, 10)", (q_locking,))
        assert len(r) == 3 and not any(x[3] for x in r) and r[0][1] == "dQw4w9WgXcQ"
        return "%d rows from 1 lecture(s); is_locked=False; video_id=%s; best distance=%.3f" % (len(r), r[0][1], min(x[2] for x in r))

    # ===== T28-T31, T34: privileges, scope, full-text
    @check("T28", "Privileges", "App role cannot read transcript_chunk directly")
    def _():
        as_user(U["asha"])
        return rejects("SELECT * FROM transcript_chunk", None, "permission denied")

    @check("T29", "Privileges", "App role cannot read lecture.youtube_video_id directly (column privilege)")
    def _():
        as_user(U["asha"])
        return rejects("SELECT youtube_video_id FROM lecture", None, "permission denied")

    @check("T30", "Privileges", "get_lecture() refuses a lecture outside the caller's scope")
    def _():
        as_user(U["asha"])
        return rejects("SELECT * FROM get_lecture(%s)", (state["l2"],), "no access to lecture")

    @check("T31", "Integrity", "Removing a course's last instructor is rejected at COMMIT")
    def _():
        return commit_rejects([("DELETE FROM course_instructor WHERE course_id = %s", (state["c2"],))],
                              "must have at least one instructor")

    @check("T34", "Full-text", "Keyword search finds an exact term within scope (and nothing outside it)")
    def _():
        as_user(U["asha"])
        r = rows("SELECT lecture_id, snippet FROM search_lectures_keyword('serializability')")
        out = rows("SELECT lecture_id FROM search_lectures_keyword('deadlock')")
        assert len(r) == 1 and r[0][0] == state["l1"] and "serializability" in r[0][1].lower()
        assert out == []
        return "%d rows in scope; out-of-scope term returned 0 rows" % len(r)

    # ===== Important queries (Member A's: Q1, Q3, Q5, Q9-Q12)
    sql_text = QUERIES.read_text(encoding="utf-8")
    blocks = [b for b in re.split(r"\n(?=-- Q\d+\.)", sql_text) if re.match(r"-- Q\d+\.", b)]
    for b in blocks:
        qid = re.match(r"-- (Q\d+)\.", b).group(1)

        @check(qid, "Queries", b.splitlines()[0].split(".", 1)[1].strip(), owner="A")
        def _(b=b):
            cur.execute(b)
            n = len(cur.fetchall()) if cur.description else 0
            return "ran without error, %d row(s)" % n

    # ===== Analytics and logging
    @check("T44", "Analytics", "log_search() records a search and its hits; the course activity view reflects it")
    def _():
        as_user(U["asha"])
        cur.execute("SELECT log_search('what is a lock', 'semantic', %s::jsonb)",
                    (json.dumps([{"lecture_id": state["l1"], "score": 0.07, "locked": False}]),))
        as_owner()
        r = rows("SELECT code, searches_matched, in_scope_hits FROM v_course_search_activity")
        assert r and r[0][0] == "CS301" and r[0][1] >= 1
        return "activity=%s" % (r,)

    @check("T45", "Analytics", "v_unanswered_queries lists a query asked twice that matched nothing")
    def _():
        as_user(U["asha"])
        for _i in range(2):
            cur.execute("SELECT log_search('Quantum Entanglement ', 'semantic', '[]'::jsonb)")
        as_owner()
        r = rows("SELECT query, times_asked FROM v_unanswered_queries")
        assert r == [("quantum entanglement", 2)], r
        return "view=%s" % (r,)

    @check("T50", "Analytics", "App role refreshes the materialized view through refresh_daily_searches()")
    def _():
        as_user(U["admin"])
        cur.execute("SELECT refresh_daily_searches()")
        r = rows("SELECT course_id, searches FROM mv_daily_course_searches")
        assert r and r[0][1] >= 1
        return "mv rows=%s" % (r,)

    @check("T35", "Views", "Course overview view returns course-wise figures", owner="A")
    def _():
        r = rows("SELECT code, lectures, indexed_lectures, enrolled_students, instructors FROM v_course_overview ORDER BY code")
        assert [x[0] for x in r] == ["CS301", "CS302"] and all(x[1] == 1 and x[2] == 1 for x in r)
        return "overview=%s" % (r,)

    # ===== Vector create/read/update/delete, validation and least privilege (added by A)
    @check("T37", "Procedure", "Only an admin may call create_course()")
    def _():
        as_user(U["rao"])
        return rejects("CALL create_course('CS777', 'Sneaky', 3, %s, NULL)", ([U["rao"]],), "only an admin")

    @check("T38", "Privileges", "A student with access cannot overwrite embeddings (set_chunk_embeddings)")
    def _():
        as_user(U["asha"])
        v = json.dumps([{"seq": 1, "v": topic_vec(5)}])
        return rejects("CALL set_chunk_embeddings(%s, %s::jsonb)", (state["l1"], v), "not allowed")

    @check("T39", "Validation", "A vector of the wrong dimension is rejected")
    def _():
        as_user(U["rao"])
        return rejects("CALL set_chunk_embeddings(%s, %s::jsonb)", (state["l1"], json.dumps([{"seq": 1, "v": [0.1, 0.2, 0.3]}])), "dimensions")

    @check("T40", "Validation", "Embedding count that does not match the chunks is rejected")
    def _():
        as_user(U["rao"])
        v = json.dumps([{"seq": 99, "v": topic_vec(0)}])
        return rejects("CALL set_chunk_embeddings(%s, %s::jsonb)", (state["l1"], v), "count mismatch")

    @check("T41", "Vector UPDATE", "update_chunk_text() clears the stale vector; re-embedding makes the transcript indexed again")
    def _():
        cid = one("SELECT chunk_id FROM transcript_chunk WHERE lecture_id = %s AND seq_no = 2", (state["l1"],))
        as_user(U["rao"])
        cur.execute("SELECT lecture_id, seq_no FROM update_chunk_text(%s, 'Corrected passage about two-phase locking.')", (cid,))
        assert cur.fetchone() == (state["l1"], 2)
        as_owner()
        emb, status = rows("SELECT (SELECT embedding IS NULL FROM transcript_chunk WHERE chunk_id = %s), status "
                           "FROM transcript WHERE lecture_id = %s", (cid, state["l1"]))[0]
        assert emb is True and status == "chunked"
        as_user(U["rao"])
        cur.execute("CALL set_chunk_embeddings(%s, %s::jsonb)", (state["l1"], json.dumps([{"seq": 2, "v": topic_vec(0, seed=2)}])))
        as_owner()
        assert one("SELECT status FROM transcript WHERE lecture_id = %s", (state["l1"],)) == "indexed"
        return "vector cleared (status=chunked), re-embedded (status=indexed)"

    @check("T43", "Transaction", "A failed re-upload rolls back completely: the old transcript and chunks survive")
    def _():
        bad = segments(5)
        bad[3]["end"] = bad[3]["start"]
        as_user(U["rao"])
        rejects("CALL ingest_transcript(%s, 'srt', 'new raw', %s::jsonb)", (state["l1"], json.dumps(bad)), "out-of-order")
        as_owner()
        n, raw = rows("SELECT (SELECT count(*) FROM transcript_chunk WHERE lecture_id = %s), raw_text "
                      "FROM transcript WHERE lecture_id = %s", (state["l1"], state["l1"]))[0]
        assert n == 7 and raw == "raw text"
        return "old transcript intact: chunks=%d" % n

    @check("T46", "Validation", "DB-level validation: duplicate lecture number, bad YouTube id, zero duration, bad chunk times")
    def _():
        msgs = [
            rejects("INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, created_by) VALUES (%s,1,'dup','aaaaaaaaaaa',60,%s)",
                    (state["c1"], U["rao"]), "duplicate key"),
            rejects("INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, created_by) VALUES (%s,9,'x','short',60,%s)",
                    (state["c1"], U["rao"]), "violates check constraint"),
            rejects("INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, created_by) VALUES (%s,9,'x','aaaaaaaaaaa',0,%s)",
                    (state["c1"], U["rao"]), "violates check constraint"),
            rejects("INSERT INTO transcript_chunk (lecture_id, seq_no, start_sec, end_sec, content) VALUES (%s,50,10,10,'x')",
                    (state["l1"],), "violates check constraint"),
        ]
        return "4 of 4 rejected (%s)" % "; ".join(m.split(":")[0][:40] for m in msgs)

    @check("T47", "Indexing", "HNSW and GIN indexes are used by nearest-neighbour and full-text queries (EXPLAIN)")
    def _():
        cur.execute("BEGIN")
        cur.execute("SET LOCAL enable_seqscan = off")
        cur.execute("EXPLAIN SELECT chunk_id FROM transcript_chunk ORDER BY embedding <=> %s::vector LIMIT 5", (q_locking,))
        hnsw = "\n".join(r[0] for r in cur.fetchall())
        cur.execute("EXPLAIN SELECT 1 FROM transcript_chunk WHERE tsv @@ to_tsquery('english', 'lock')")
        gin = "\n".join(r[0] for r in cur.fetchall())
        cur.execute("ROLLBACK")
        assert "idx_chunk_embedding_hnsw" in hnsw, hnsw
        assert "idx_chunk_tsv" in gin, gin
        return "plans use idx_chunk_embedding_hnsw and idx_chunk_tsv"

    @check("T54", "Privileges", "course_lectures() shows an instructor their course's lectures (with video id and status), and refuses others")
    def _():
        as_user(U["rao"])
        r = rows("SELECT lecture_no, youtube_video_id, transcript_status, chunk_count, embedded_chunks FROM course_lectures(%s)", (state["c1"],))
        assert r == [(1, "dQw4w9WgXcQ", "indexed", 7, 7)], r
        a = rejects("SELECT * FROM course_lectures(%s)", (state["c2"],), "not allowed to manage")
        as_user(U["asha"])
        b = rejects("SELECT * FROM course_lectures(%s)", (state["c1"],), "not allowed to manage")
        return "instructor sees %s; other instructor and student refused" % (r[0],)

    @check("T53", "Privileges", "Analyst role reads analytics views only (no search function, no chunk table)")
    def _():
        as_user(U["admin"], role="lecturelens_analyst")
        n = len(rows("SELECT * FROM v_course_overview"))
        a = rejects("SELECT * FROM transcript_chunk", None, "permission denied")
        b = rejects("SELECT * FROM search_lectures(%s::vector, 5)", (q_locking,), "permission denied")
        return "view rows=%d; chunk table and search_lectures denied" % n

    @check("T36", "Cascade", "Deleting a lecture cascades to its transcript, chunks, hits and requests")
    def _():
        cur.execute("BEGIN")
        cur.execute("INSERT INTO access_request (student_id, lecture_id, reason) VALUES (%s,%s,'curious')", (U["asha"], state["l2"]))
        cur.execute("DELETE FROM lecture WHERE lecture_id = %s", (state["l2"],))
        n_chunks = one("SELECT count(*) FROM transcript_chunk WHERE lecture_id = %s", (state["l2"],))
        n_req = one("SELECT count(*) FROM access_request WHERE lecture_id = %s", (state["l2"],))
        cur.execute("ROLLBACK")
        assert n_chunks == 0 and n_req == 0
        return "remaining chunks,requests=(%d, %d)" % (n_chunks, n_req)

    @check("T42", "Vector DELETE", "delete_transcript() removes chunks and vectors; the lecture disappears from search")
    def _():
        as_user(U["iyer"])
        cur.execute("CALL delete_transcript(%s)", (state["l2"],))
        as_user(U["admin"])
        r = rows("SELECT * FROM search_lectures(%s::vector, 10)", (q_deadlock,))
        as_owner()
        n = one("SELECT count(*) FROM transcript_chunk WHERE lecture_id = %s", (state["l2"],))
        assert n == 0 and r == []
        return "chunks left=%d; search for its topic now returns %d rows" % (n, len(r))

    # ---------------------------------------------------------------- report
    order = lambda r: (r["id"][0] != "T", int(re.sub(r"\D", "", r["id"]) or 0))  # noqa: E731
    RESULTS.sort(key=order)
    print()
    print("%-5s %-14s %-6s %s" % ("ID", "Area", "Result", "Check"))
    for r in RESULTS:
        print("%-5s %-14s %-6s %s" % (r["id"], r["area"], r["result"], r["check"]))
        if r["result"] != "PASS":
            print("      observed: " + r["observed"])
    passed = sum(1 for r in RESULTS if r["result"] == "PASS")
    RESULTS_FILE.write_text(json.dumps(dict(postgres=one("SHOW server_version"), pgvector=pgv, stubs=[s.name for s in used_stubs],
                                            results=RESULTS), indent=2), encoding="utf-8")
    cur.close()
    conn.close()
    server.cleanup()
    shutil.rmtree(data_dir, ignore_errors=True)
    print("\n%d/%d passed" % (passed, len(RESULTS)))
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
