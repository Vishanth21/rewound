// GET  /api/courses/:id/lectures  lectures of a course with transcript status (managers only)
// POST /api/courses/:id/lectures  add a lecture (instructor of the course, or admin)
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { canManageCourse, parseId } from "@/lib/manage";
import { parseYouTubeId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid course id.");
  try {
    const rows = await withUser(session.user.id, async (c) => (await c.query("SELECT * FROM course_lectures($1)", [id])).rows);
    return Response.json({ lectures: rows });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

const Create = z.object({
  lectureNo: z.coerce.number().int().min(1, "Lecture number must be 1 or more.").max(999),
  title: z.string().trim().min(1, "Title cannot be blank.").max(200),
  video: z.string().trim().min(1, "Paste the YouTube link."),
  durationSec: z.coerce.number().int().min(1, "Duration must be a positive number of seconds.").max(86400),
  deliveredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.").nullish(),
  description: z.string().trim().max(1000).nullish(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const courseId = parseId(params.id);
  if (!courseId) return badRequest("Invalid course id.");
  const body = Create.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0].message);
  const b = body.data;
  const videoId = parseYouTubeId(b.video);
  if (!videoId) return badRequest("That is not a valid YouTube link or video id.");

  try {
    return await withUser(session.user.id, async (c) => {
      if (!(await canManageCourse(c, session, courseId))) return Response.json({ error: "You do not teach this course." }, { status: 403 });
      const r = await c.query(
        `INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, delivered_on, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING lecture_id`,
        [courseId, b.lectureNo, b.title, videoId, b.durationSec, b.deliveredOn || null, b.description || null, session.user.id],
      );
      return Response.json({ ok: true, lectureId: r.rows[0].lecture_id }, { status: 201 });
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
