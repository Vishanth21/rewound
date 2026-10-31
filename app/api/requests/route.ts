// GET  /api/requests   the caller's request history (v_request_history, filtered by RLS)
// POST /api/requests   ask for access to one lecture; body { lectureId, reason }
//
// Contract with app/search/RequestAccess.tsx: POST returns 2xx on success, or
// { error: string } with a 4xx. The database decides everything that matters --
// request_access() runs the triggers, so "already has access" and "already pending"
// come back as real SQLSTATEs and reach the UI through dbErrorResponse().
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
    // RLS on access_request decides visibility: a student sees their own rows, an
    // instructor the requests on lectures they uploaded, an admin everything.
    const rows = await withUser(session.user.id, async (c) =>
      (
        await c.query(
          `SELECT request_id, course_code, lecture_no, lecture_title, requested_at,
                  status, expires_at, access_state
             FROM v_request_history
         ORDER BY requested_at DESC, request_id DESC`,
        )
      ).rows,
    );
    return Response.json({
      requests: rows.map((r) => ({
        requestId: r.request_id,
        courseCode: r.course_code,
        lectureNo: r.lecture_no,
        lectureTitle: r.lecture_title,
        requestedAt: r.requested_at,
        status: r.status,
        expiresAt: r.expires_at,
        // 'active' | 'expired' for an approval, null while pending or rejected --
        // derived in SQL, there is no stored status column to go stale.
        accessState: r.access_state,
      })),
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

const NewRequest = z.object({
  lectureId: z.coerce.number().int().positive(),
  // The table's own CHECK is btrim(reason) <> '' and varchar(500); checking the shape
  // here gives a clean 400 instead of a 422 carrying a raw constraint name.
  reason: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "Say why you need this lecture.").max(500, "Keep the reason under 500 characters.")),
});

export async function POST(req: Request) {
  const session = await requireApi(["student"]);
  if (isResponse(session)) return session;

  const parsed = NewRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { lectureId, reason } = parsed.data;

  try {
    const requestId = await withUser(session.user.id, async (c) =>
      (await c.query("SELECT request_access($1, $2) AS id", [lectureId, reason])).rows[0].id,
    );
    return Response.json({ ok: true, requestId }, { status: 201 });
  } catch (e) {
    // 23514 "already has access" / "no transcript yet" -> 422
    // 23505 "already have a pending request"           -> 409
    // 42501 not a student                              -> 403
    return dbErrorResponse(e);
  }
}