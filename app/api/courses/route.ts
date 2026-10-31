// GET  /api/courses  course list with figures (v_course_overview)
// POST /api/courses  admin creates a course with its instructors (create_course procedure)
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApi();
  if (isResponse(session)) return session;
  try {
    const rows = await withUser(session.user.id, async (c) => (await c.query("SELECT * FROM v_course_overview ORDER BY code")).rows);
    return Response.json({ courses: rows });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

const Create = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/, "Course code must be 4-12 capital letters or digits, e.g. CS301."),
  title: z.string().trim().min(1, "Title cannot be blank.").max(150),
  semester: z.coerce.number().int().min(1).max(8),
  instructorIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one instructor."),
});

export async function POST(req: Request) {
  const session = await requireApi(["admin"]);
  if (isResponse(session)) return session;
  const body = Create.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0].message);
  const b = body.data;
  try {
    const id = await withUser(session.user.id, async (c) => {
      const r = await c.query("CALL create_course($1, $2, $3, $4::integer[], NULL)", [b.code, b.title, b.semester, b.instructorIds]);
      return r.rows[0]?.p_course_id as number;
    });
    return Response.json({ ok: true, courseId: id }, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
