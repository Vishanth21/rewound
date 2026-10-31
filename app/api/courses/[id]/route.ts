// PATCH  /api/courses/:id   admin edits title/semester and replaces the instructor list
// DELETE /api/courses/:id   admin deletes a course (lectures, transcripts and chunks cascade)
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { parseId } from "@/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z
  .object({
    title: z.string().trim().min(1, "Title cannot be blank.").max(150),
    semester: z.coerce.number().int().min(1).max(8),
    instructorIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one instructor."),
  })
  .partial();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid course id.");
  const body = Patch.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0].message);
  const b = body.data;
  try {
    return await withUser(session.user.id, async (c) => {
      if (b.title !== undefined || b.semester !== undefined) {
        const r = await c.query(
          "UPDATE course SET title = COALESCE($2, title), semester = COALESCE($3, semester) WHERE course_id = $1",
          [id, b.title ?? null, b.semester ?? null],
        );
        if (!r.rowCount) return Response.json({ error: "Course not found." }, { status: 404 });
      }
      if (b.instructorIds) {
        // Add the new ones first, then remove the old ones. The "at least one instructor" rule
        // is checked at COMMIT, so the course is never without a teacher.
        await c.query(
          "INSERT INTO course_instructor (course_id, instructor_id) SELECT $1, unnest($2::integer[]) ON CONFLICT DO NOTHING",
          [id, b.instructorIds],
        );
        await c.query("DELETE FROM course_instructor WHERE course_id = $1 AND instructor_id <> ALL($2::integer[])", [id, b.instructorIds]);
      }
      return Response.json({ ok: true });
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid course id.");
  try {
    const r = await withUser(session.user.id, (c) => c.query("DELETE FROM course WHERE course_id = $1", [id]));
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ error: "Course not found." }, { status: 404 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
