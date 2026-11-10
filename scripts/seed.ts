// scripts/seed.ts   npm run db:seed   (fresh schema or resume a partially completed demo seed)
//
// 1. users and enrollments      db/seed/10_users.sql, db/seed/30_enrollments_requests.sql (Member B)
// 2. courses and lectures       db/seed/20_courses_lectures.sql (Member A)
// 3. transcripts                (Member A) every db/seed/transcripts/<CODE>-<NN>.srt|vtt goes
//                                through the SAME path as an instructor upload: parse in Node,
//                                CALL ingest_transcript() as the course's instructor, embed with
//                                MiniLM, CALL set_chunk_embeddings(). Skips completed transcripts.
// 4. demo requests              (Member B) request_access() as the student, decide_request() as the
//                                approver. Must come AFTER step 3: a request needs a transcript.
import { need } from "./env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { pool, withUser } from "@/lib/db";
import { EMBED_BACKEND, type EmbedModelProgress } from "@/lib/embed";
import { storeEmbeddings } from "@/lib/ingest";
import { parseTranscript } from "@/lib/transcript-parse";

const TRANSCRIPTS = "db/seed/transcripts";

// [student e-mail, course code, lecture_no, approve?, days of access when approved, reason]
// days = -1 leaves the request PENDING; it is ignored when approve is false.
type DemoRequest = [email: string, code: string, lecture_no: number, approve: boolean, days: number, reason: string];
// Every target must be a course the student is NOT enrolled in: fn_request_before_insert() refuses
// a request when has_lecture_access() already holds. Enrollments (db/seed/30_...sql): Asha CS301+CS302,
// Ben CS302+CS303, Chitra CS303.
const REQUESTS: DemoRequest[] = [
  // Asha (CS301+CS302) asks Menon for a CS303 lecture, and is approved by the uploader.
  ["asha@pes.edu", "CS303", 2, true, 30, "Covered in my ML project; need the gradient descent derivation."],
  // Ben (CS302+CS303) asks Rao for a CS301 lecture; the admin rejects it (a non-uploader decision).
  ["ben@pes.edu", "CS301", 3, false, 0, "Want to compare indexing strategies for my OS assignment."],
  // Chitra (CS303) asks Iyer for a CS302 lecture and it stays PENDING, so /inbox has something
  // to decide in the demo.
  ["chitra@pes.edu", "CS302", 1, true, -1, "Revision for the OS quiz next week."],
];
const DECIDER_REJECTS = "admin@pes.edu"; // rejected requests are decided by the admin

type Target = { lecture_id: number; course_id: number; code: string; lecture_no: number; instructor_id: number };

const EXPECTED_USERS = 7;
const EXPECTED_COURSES = 3;
const EXPECTED_LECTURES = 9;
const EXPECTED_ENROLLMENTS = 5;

// user_id by e-mail. Runs on the app pool (step 4 is after the owner connection is closed);
// lecturelens_app has SELECT on app_user.
async function userId(email: string): Promise<number> {
  const { rows } = await pool.query("SELECT user_id FROM app_user WHERE lower(email) = lower($1)", [email]);
  if (!rows[0]) throw new Error(`no user ${email}`);
  return rows[0].user_id as number;
}

function logModelProgress(progress: EmbedModelProgress) {
  if (progress.status === "progress_total" && typeof progress.progress === "number") {
    const percent = Math.floor(progress.progress);
    if (percent % 10 === 0 || percent === 100) {
      const loaded = typeof progress.loaded === "number" ? ` (${formatMb(progress.loaded)} / ${formatMb(progress.total)})` : "";
      console.log(`  model download: ${percent}%${loaded}`);
    }
  } else if (progress.status === "retry") {
    console.log(`  model request failed temporarily; retrying in ${progress.file}…`);
  } else if (progress.status === "ready") {
    console.log("  embedding model ready");
  }
}

function formatMb(bytes: number | undefined): string {
  return typeof bytes === "number" ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "unknown size";
}

async function transcriptStatus(user: number, target: Target) {
  return withUser(user, async (c) => {
    const { rows } = await c.query(
      `SELECT transcript_status, chunk_count::int, embedded_chunks::int
         FROM course_lectures($1) WHERE lecture_id = $2`,
      [target.course_id, target.lecture_id],
    );
    return rows[0] as { transcript_status: string | null; chunk_count: number; embedded_chunks: number } | undefined;
  });
}

async function getOrCreateChunks(user: number, target: Target, parsed: ReturnType<typeof parseTranscript>, raw: string) {
  const status = await transcriptStatus(user, target);
  if (status?.chunk_count) {
    return withUser(user, async (c) =>
      (await c.query("SELECT seq_no, content FROM get_lecture($1) ORDER BY seq_no", [target.lecture_id])).rows as { seq_no: number; content: string }[],
    );
  }

  return withUser(user, async (c) => {
    await c.query("CALL ingest_transcript($1, $2, $3, $4::jsonb)", [
      target.lecture_id, parsed.format, raw, JSON.stringify(parsed.segments),
    ]);
    return (await c.query("SELECT seq_no, content FROM get_lecture($1) ORDER BY seq_no", [target.lecture_id])).rows as { seq_no: number; content: string }[];
  });
}

async function main() {
  const owner = new Client({ connectionString: need("MIGRATION_DATABASE_URL") });
  await owner.connect();
  let targets: Target[];
  try {
    const counts = (await owner.query(`SELECT
      (SELECT count(*)::int FROM app_user) AS users,
      (SELECT count(*)::int FROM course) AS courses,
      (SELECT count(*)::int FROM lecture) AS lectures,
      (SELECT count(*)::int FROM enrollment) AS enrollments,
      (SELECT count(*)::int FROM app_user WHERE lower(email) IN
        ('admin@pes.edu','rao@pes.edu','iyer@pes.edu','menon@pes.edu','asha@pes.edu','ben@pes.edu','chitra@pes.edu')) AS demo_users,
      (SELECT count(*)::int FROM course WHERE code IN ('CS301','CS302','CS303')) AS demo_courses,
      (SELECT count(*)::int FROM lecture l JOIN course c ON c.course_id = l.course_id
        WHERE c.code IN ('CS301','CS302','CS303')) AS demo_lectures`)).rows[0] as {
        users: number; courses: number; lectures: number; enrollments: number;
        demo_users: number; demo_courses: number; demo_lectures: number;
      };

    if (counts.users === 0 && counts.courses === 0 && counts.lectures === 0 && counts.enrollments === 0) {
      // Keep the base demo data atomic. If any statement fails, a later seed can safely start over.
      await owner.query("BEGIN");
      try {
        await owner.query(readFileSync("db/seed/10_users.sql", "utf8"));
        await owner.query(readFileSync("db/seed/20_courses_lectures.sql", "utf8"));
        await owner.query(readFileSync("db/seed/30_enrollments_requests.sql", "utf8"));
        await owner.query("COMMIT");
      } catch (error) {
        await owner.query("ROLLBACK");
        throw error;
      }
      console.log("users: 7 (password for all: demo1234)");
      console.log("courses + lectures: 9 lectures");
      console.log("enrollments: 5");
    } else if (
      counts.users === EXPECTED_USERS && counts.courses === EXPECTED_COURSES &&
      counts.lectures === EXPECTED_LECTURES && counts.enrollments === EXPECTED_ENROLLMENTS &&
      counts.demo_users === EXPECTED_USERS && counts.demo_courses === EXPECTED_COURSES &&
      counts.demo_lectures === EXPECTED_LECTURES
    ) {
      console.log("demo users, courses, lectures, and enrollments already exist; resuming seed");
    } else {
      throw new Error(
        `Found partial or non-demo seed data (users ${counts.users}, courses ${counts.courses}, lectures ${counts.lectures}, enrollments ${counts.enrollments}). ` +
        "Seed will not overwrite it. Inspect the database or reset it only if it contains no data you need.",
      );
    }

    // Each transcript is uploaded by (and so approved by) the course's first instructor.
    targets = (
      await owner.query(`SELECT l.lecture_id, co.course_id, co.code, l.lecture_no,
                                (SELECT min(ci.instructor_id) FROM course_instructor ci
                                  WHERE ci.course_id = co.course_id) AS instructor_id
                           FROM lecture l JOIN course co ON co.course_id = l.course_id`)
    ).rows;
  } finally {
    await owner.end();
  }

  // 3. transcripts, through the app role (DATABASE_URL) exactly like an upload
  console.log(`embedding backend: ${EMBED_BACKEND}${EMBED_BACKEND === "minilm" ? " (first run downloads the model, ~23 MB)" : ""}`);
  for (const file of readdirSync(TRANSCRIPTS).sort()) {
    const m = /^([A-Z0-9]+)-(\d+)\.(srt|vtt)$/i.exec(file);
    if (!m) continue;
    const t = targets.find((x) => x.code === m[1].toUpperCase() && x.lecture_no === Number(m[2]));
    if (!t) {
      console.warn(`skip ${file}: no lecture ${m[1]} #${Number(m[2])}`);
      continue;
    }
    const raw = readFileSync(path.join(TRANSCRIPTS, file), "utf8");
    const parsed = parseTranscript(raw);
    const current = await transcriptStatus(t.instructor_id, t);
    if (current?.transcript_status === "indexed" && current.chunk_count > 0 && current.embedded_chunks === current.chunk_count) {
      console.log(`  ${file}: already indexed; skipping`);
      continue;
    }

    const chunks = await getOrCreateChunks(t.instructor_id, t, parsed, raw);
    console.log(`  ${file}: ${parsed.segments.length} cues -> ${chunks.length} chunks; embedding…`);
    await storeEmbeddings(t.instructor_id, t.lecture_id, chunks, logModelProgress);
    console.log(`  ${file}: ${parsed.segments.length} cues -> ${chunks.length} chunks, indexed`);
  }

  // 4. demo access requests -- after step 3, because fn_request_before_insert() refuses a lecture
  //    with no transcript (the transcript is what names the approver). request_access() and
  //    decide_request() run as the real users, so the triggers are exercised, not bypassed.
  for (const [email, code, lectureNo, approve, days, reason] of REQUESTS) {
    const t = targets.find((x) => x.code === code && x.lecture_no === lectureNo);
    if (!t) throw new Error(`no lecture ${code} #${lectureNo} for the demo request`);
    const student = await userId(email);
    const existing = await withUser(student, async (c) => {
      const { rows } = await c.query(
        "SELECT request_id, status, reason FROM access_request WHERE student_id = $1 AND lecture_id = $2 ORDER BY request_id DESC LIMIT 1",
        [student, t.lecture_id],
      );
      return rows[0] as { request_id: number; status: string; reason: string } | undefined;
    });
    if (existing && existing.reason !== reason) {
      throw new Error(`existing access request for ${email} -> ${code} #${lectureNo} has a different reason; refusing to alter it`);
    }
    const requestId = existing?.request_id ?? await withUser(student, async (c) => {
      const { rows } = await c.query("SELECT request_access($1, $2) AS id", [t.lecture_id, reason]);
      return rows[0].id as number;
    });
    const requestStatus = existing?.status ?? "pending";
    // days === -1 means "leave it pending" (a real approval needs 1-90 days, so no valid value
    // collides with it), so /inbox has something left to decide.
    if (days === -1) {
      console.log(`  ${email} -> ${code} #${lectureNo}: ${requestStatus} (request ${requestId})`);
      continue;
    }
    if (requestStatus !== "pending") {
      console.log(`  ${email} -> ${code} #${lectureNo}: already ${requestStatus} (request ${requestId})`);
      continue;
    }
    // The uploader approves; a rejection is made by the admin instead (a non-uploader decision).
    const decider = approve ? t.instructor_id : await userId(DECIDER_REJECTS);
    await withUser(decider, (c) => c.query("CALL decide_request($1, $2, $3)", [requestId, approve, approve ? days : null]));
    console.log(`  ${email} -> ${code} #${lectureNo}: ${approve ? `approved for ${days} days` : "rejected"} (request ${requestId})`);
  }

  await pool.end();
  console.log("seed complete");
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await pool.end().catch(() => {});
  process.exit(1);
});
