// POST   /api/enrollments   body { studentId, courseId }
// DELETE /api/enrollments   body { studentId, courseId }
//
// Plain INSERT / DELETE on the pair table. trg_enrollment_role (010_users.sql) raises
// 23514 if studentId is not a student, the FK raises 23503 for an unknown user or course,
// and the PK raises 23505 on a duplicate -- dbErrorResponse() maps all three to 4xx, so
// the route does not repeat any of those checks in JavaScript.
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Pair = z.object({
  studentId: z.coerce.number().int().positive(),
  courseId: z.coerce.number().int().positive(),
});

async function readPair(req: Request) {
  const parsed = Pair.safeParse(await req.json().catch(() => null));
  return parsed.success ? { pair: parsed.data } : { error: badRequest(parsed.error.issues[0].message) };
}

export async function POST(req: Request) {
  const session = await requireApi(["admin"]);
  if (isResponse(session)) return session;

  const { pair, error } = await readPair(req);
  if (error) return error;

  try {
    await withUser(session.user.id, async (c) => {
      await c.query("INSERT INTO enrollment (student_id, course_id) VALUES ($1, $2)", [pair.studentId, pair.courseId]);
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

export async function DELETE(req: Request) {
  const session = await requireApi(["admin"]);
  if (isResponse(session)) return session;

  const { pair, error } = await readPair(req);
  if (error) return error;

  try {
    const removed = await withUser(session.user.id, async (c) =>
      (await c.query("DELETE FROM enrollment WHERE student_id = $1 AND course_id = $2", [pair.studentId, pair.courseId]))
        .rowCount,
    );
    // rowCount 0 is a stale page, not a server fault: the row is already gone, so say so
    // instead of pretending the delete did something.
    if (removed === 0) return Response.json({ error: "That enrollment no longer exists." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return dbErrorResponse(e);
  }
}