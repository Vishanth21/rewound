// GET /api/search?q=...&mode=semantic|keyword&course=CS301
// Calls search_lectures() / search_lectures_keyword() as the logged-in user, so the database
// decides what is in scope and what is only disclosed as locked. Also logs the search.
import { z } from "zod";
import { withUser } from "@/lib/db";
import { embed, toVectorLiteral } from "@/lib/embed";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 10; // lectures per result page

const Params = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters.").max(300, "Keep the question under 300 characters."),
  mode: z.enum(["semantic", "keyword"]).default("semantic"),
  course: z.string().trim().max(12).optional(),
});

type Passage = { chunkId: number | null; startSec: number | null; text: string; distance: number | null };
type Result = {
  lectureId: number;
  courseCode: string;
  lectureNo: number;
  title: string;
  locked: boolean;
  score: number;
  passages: Passage[];
};

export async function GET(req: Request) {
  const session = await requireApi();
  if (isResponse(session)) return session;

  const sp = new URL(req.url).searchParams;
  const parsed = Params.safeParse({ q: sp.get("q") ?? "", mode: sp.get("mode") ?? undefined, course: sp.get("course") || undefined });
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { q, mode, course } = parsed.data;

  try {
    const vec = mode === "semantic" ? toVectorLiteral((await embed([q]))[0]) : null;
    // With a course filter, fetch more lectures first so filtering still leaves up to 10.
    const fetchLimit = course ? 50 : LIMIT;
    const results = await withUser(session.user.id, async (c) => {
      const byLecture = new Map<number, Result>();
      if (mode === "semantic") {
        const { rows } = await c.query("SELECT * FROM search_lectures($1::vector, $2)", [vec, fetchLimit]);
        for (const r of rows) {
          const res: Result = byLecture.get(r.lecture_id) ?? {
            lectureId: r.lecture_id, courseCode: r.course_code, lectureNo: r.lecture_no, title: r.lecture_title,
            locked: r.is_locked, score: r.distance, passages: [],
          };
          res.passages.push({ chunkId: r.chunk_id === null ? null : Number(r.chunk_id), startSec: r.start_sec === null ? null : Number(r.start_sec), text: r.snippet, distance: r.distance });
          res.score = Math.min(res.score, r.distance);
          byLecture.set(r.lecture_id, res);
        }
      } else {
        const { rows } = await c.query("SELECT * FROM search_lectures_keyword($1, $2)", [q, fetchLimit]);
        for (const r of rows) {
          // Keyword results have no locked disclosure; the lecture page loads the video itself.
          byLecture.set(r.lecture_id, {
            lectureId: r.lecture_id, courseCode: r.course_code, lectureNo: r.lecture_no, title: r.lecture_title, locked: false, score: r.rank,
            passages: [{ chunkId: null, startSec: Number(r.start_sec), text: r.snippet, distance: null }],
          });
        }
      }
      let list = [...byLecture.values()];
      if (course) list = list.filter((r) => r.courseCode === course.toUpperCase()).slice(0, LIMIT);
      await c.query("SELECT log_search($1, $2, $3::jsonb)", [
        q, mode, JSON.stringify(list.map((r) => ({ lecture_id: r.lectureId, score: r.score, locked: r.locked }))),
      ]);
      return list;
    });
    return Response.json({ mode, query: q, results });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
