// scripts/seed.ts   npm run db:seed   (run on a freshly migrated database: npm run db:reset first)
//
// 1. users and enrollments      STAND-IN for Member B's 10_users.sql / 30_enrollments_requests.sql:
//                                passwords are bcrypt-hashed here, never typed into SQL
// 2. courses and lectures       db/seed/20_courses_lectures.sql (Member A)
// 3. transcripts                (Member A) every db/seed/transcripts/<CODE>-<NN>.srt|vtt goes
//                                through the SAME path as an instructor upload: parse in Node,
//                                CALL ingest_transcript() as the course's instructor, embed with
//                                MiniLM, CALL set_chunk_embeddings(). Downloads the model once.
import { need } from "./env";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { pool, withUser } from "@/lib/db";
import { EMBED_BACKEND } from "@/lib/embed";
import { storeEmbeddings } from "@/lib/ingest";
import { parseTranscript } from "@/lib/transcript-parse";

const DEMO_PASSWORD = "demo1234"; // documented in .env.example; demo accounts only

const USERS: [email: string, name: string, role: "admin" | "instructor" | "student"][] = [
  ["admin@pes.edu", "Admin", "admin"],
  ["rao@pes.edu", "Dr. Rao", "instructor"],
  ["iyer@pes.edu", "Dr. Iyer", "instructor"],
  ["menon@pes.edu", "Dr. Menon", "instructor"],
  ["asha@pes.edu", "Asha", "student"],
  ["ben@pes.edu", "Ben", "student"],
  ["chitra@pes.edu", "Chitra", "student"],
];
const ENROLLMENTS: [email: string, code: string][] = [
  ["asha@pes.edu", "CS301"],
  ["ben@pes.edu", "CS302"],
  ["chitra@pes.edu", "CS303"],
];
const TRANSCRIPTS = "db/seed/transcripts";

type Target = { lecture_id: number; code: string; lecture_no: number; instructor_id: number };

async function main() {
  const owner = new Client({ connectionString: need("MIGRATION_DATABASE_URL") });
  await owner.connect();
  let targets: Target[];
  try {
    if ((await owner.query("SELECT count(*)::int AS n FROM app_user")).rows[0].n > 0) {
      throw new Error("The database already has users. Run `npm run db:reset` first, then seed again.");
    }

    // 1. users + enrollments (stand-in for Member B's seed files)
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    for (const [email, name, role] of USERS) {
      await owner.query("INSERT INTO app_user (email, full_name, password_hash, role) VALUES ($1, $2, $3, $4)", [email, name, hash, role]);
    }
    console.log(`users: ${USERS.length} (password for all: ${DEMO_PASSWORD})`);

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

    for (const [email, code] of ENROLLMENTS) {
      await owner.query(
        `INSERT INTO enrollment (student_id, course_id)
         SELECT u.user_id, co.course_id FROM app_user u, course co WHERE lower(u.email) = $1 AND co.code = $2`,
        [email, code],
      );
    }
    console.log(`enrollments: ${ENROLLMENTS.length}`);
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
  await pool.end();
  console.log("seed complete");
}

main().catch(async (e) => {
  console.error(e.message ?? e);
  await pool.end().catch(() => {});
  process.exit(1);
});
