// GET    /api/lectures/:id  full transcript for a lecture the user may open (get_lecture)
// PATCH  /api/lectures/:id  edit lecture details (instructor of the course, or admin)
// DELETE /api/lectures/:id  delete the lecture; its transcript and chunks cascade
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { canManageLecture, parseId } from "@/lib/manage";
import { parseYouTubeId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi();
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid lecture id.");
  try {
    const rows = await withUser(session.user.id, async (c) => (await c.query("SELECT * FROM get_lecture($1)", [id])).rows);
    if (rows.length === 0) return Response.json({ error: "This lecture has no transcript yet." }, { status: 404 });
    return Response.json({
      title: rows[0].lecture_title, courseCode: rows[0].course_code, videoId: rows[0].youtube_video_id,
      chunks: rows.map((r) => ({ chunkId: Number(r.chunk_id), seqNo: r.seq_no, startSec: Number(r.start_sec), endSec: Number(r.end_sec), text: r.content })),
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

const Patch = z
  .object({
    lectureNo: z.coerce.number().int().min(1).max(999),
    title: z.string().trim().min(1).max(200),
    video: z.string().trim().min(1),
    durationSec: z.coerce.number().int().min(1).max(86400),
    deliveredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    description: z.string().trim().max(1000).nullable(),
  })
  .partial();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid lecture id.");
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0].message);
  const b = body.data;

  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (b.lectureNo !== undefined) add("lecture_no", b.lectureNo);
  if (b.title !== undefined) add("title", b.title);
  if (b.video !== undefined) {
    const vid = parseYouTubeId(b.video);
    if (!vid) return badRequest("That is not a valid YouTube link or video id.");
    add("youtube_video_id", vid);
  }
  if (b.durationSec !== undefined) add("duration_sec", b.durationSec);
  if (b.deliveredOn !== undefined) add("delivered_on", b.deliveredOn);
  if (b.description !== undefined) add("description", b.description === "" ? null : b.description);
  if (sets.length === 0) return badRequest("Nothing to update.");

  try {
    return await withUser(session.user.id, async (c) => {
      if (!(await canManageLecture(c, session, id))) return Response.json({ error: "You do not teach this course." }, { status: 403 });
      vals.push(id);
      const r = await c.query(`UPDATE lecture SET ${sets.join(", ")} WHERE lecture_id = $${vals.length}`, vals);
      return r.rowCount ? Response.json({ ok: true }) : Response.json({ error: "Lecture not found." }, { status: 404 });
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid lecture id.");
  try {
    return await withUser(session.user.id, async (c) => {
      if (!(await canManageLecture(c, session, id))) return Response.json({ error: "You do not teach this course." }, { status: 403 });
      const r = await c.query("DELETE FROM lecture WHERE lecture_id = $1", [id]);
      return r.rowCount ? Response.json({ ok: true }) : Response.json({ error: "Lecture not found." }, { status: 404 });
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
