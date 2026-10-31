// scripts/seed.ts   npm run db:seed   (run on a freshly migrated database: npm run db:reset first)
//
// 1. users and enrollments      db/seed/10_users.sql, db/seed/30_enrollments_requests.sql (Member B)
// 2. courses and lectures       db/seed/20_courses_lectures.sql (Member A)
// 3. transcripts                (Member A) every db/seed/transcripts/<CODE>-<NN>.srt|vtt goes
//                                through the SAME path as an instructor upload: parse in Node,
//                                CALL ingest_transcript() as the course's instructor, embed with
//                                MiniLM, CALL set_chunk_embeddings(). Downloads the model once.
// 4. demo requests              (Member B) request_access() as the student, decide_request() as the
//                                approver. Must come AFTER step 3: a request needs a transcript.
import { need } from "./env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { pool, withUser } from "@/lib/db";
import { EMBED_BACKEND } from "@/lib/embed";
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

type Target = { lecture_id: number; code: string; lecture_no: number; instructor_id: number };

// user_id by e-mail. Runs on the app pool (step 4 is after the owner connection is closed);
// lecturelens_app has SELECT on app_user.
async function userId(email: string): Promise<number> {
  const { rows } = await pool.query("SELECT user_id FROM app_user WHERE lower(email) = lower($1)", [email]);
  if (!rows[0]) throw new Error(`no user ${email}`);
  return rows[0].user_id as number;
}

async function main() {
  const owner = new Client({ connectionString: need("MIGRATION_DATABASE_URL") });
  await owner.connect();
  let targets: Target[];
  try {
    if ((await owner.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n > 0) {
      throw new Error("The database already has users. Run `npm run db:reset` first, then seed again.");
    }

    // 1. users, then enrollments (both Member B's SQL files; 30_ needs the courses from step 2,
    //    so it runs after 20_ below)
    await owner.query(readFileSync("db/seed/10_users.sql", "utf8"));
    console.log("users: 7 (password for all: demo1234)");

    // 2. courses + lectures
    await owner.query("BEGIN");
    await owner.query(readFileSync("db/seed/20_courses_lectures.sql", "utf8"));
    await owner.query("COMMIT");
    // Each transcript is uploaded by (and so approved by) the course's first instructor.
    targets = (
      await owner.query(`SELECT l.lecture_id, co.code, l.lecture_no,
                                (SELECT min(ci.instructor_id) FROM course_instructor ci
                                  WHERE ci.course_id = co.course_id) AS instructor_id
                           FROM lecture l JOIN course co ON co.course_id = l.course_id`)
    ).rows;
    console.log(`courses + lectures: ${targets.length} lectures`);

    // 1b. enrollments (after the courses exist)
    await owner.query(readFileSync("db/seed/30_enrollments_requests.sql", "utf8"));
    console.log("enrollments: 5");
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
    const chunks = await withUser(t.instructor_id, async (c) => {
      await c.query("CALL ingest_transcript($1, $2, $3, $4::jsonb)", [t.lecture_id, parsed.format, raw, JSON.stringify(parsed.segments)]);
      return (await c.query("SELECT seq_no, content FROM get_lecture($1) ORDER BY seq_no", [t.lecture_id])).rows as { seq_no: number; content: string }[];
    });
    await storeEmbeddings(t.instructor_id, t.lecture_id, chunks);
    console.log(`  ${file}: ${parsed.segments.length} cues -> ${chunks.length} chunks, indexed`);
  }

  // 4. demo access requests -- after step 3, because fn_request_before_insert() refuses a lecture
  //    with no transcript (the transcript is what names the approver). request_access() and
  //    decide_request() run as the real users, so the triggers are exercised, not bypassed.
  for (const [email, code, lectureNo, approve, days, reason] of REQUESTS) {
    const t = targets.find((x) => x.code === code && x.lecture_no === lectureNo);
    if (!t) throw new Error(`no lecture ${code} #${lectureNo} for the demo request`);
    const student = await userId(email);
    const requestId = await withUser(student, async (c) => {
      const { rows } = await c.query("SELECT request_access($1, $2) AS id", [t.lecture_id, reason]);
      return rows[0].id as number;
    });
    // days === -1 means "leave it pending" (a real approval needs 1-90 days, so no valid value
    // collides with it), so /inbox has something left to decide.
    if (days === -1) {
      console.log(`  ${email} -> ${code} #${lectureNo}: pending (request ${requestId})`);
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
