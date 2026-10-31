// GET /api/inbox   pending requests the caller may decide, plus the badge count.
//
// my_pending_requests() already joins transcript.uploaded_by, so an instructor only
// sees requests on lectures they uploaded and an admin sees everything. The database
// decides; this route just shapes the JSON.
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { dbErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;

  try {
    const rows = await withUser(session.user.id, async (c) =>
      (await c.query("SELECT * FROM my_pending_requests() ORDER BY requested_at")).rows,
    );
    return Response.json({
      pending: rows.length,
      requests: rows.map((r) => ({
        requestId: r.request_id,
        studentName: r.student_name,
        courseCode: r.course_code,
        lectureNo: r.lecture_no,
        lectureTitle: r.lecture_title,
        reason: r.reason,
        requestedAt: r.requested_at,
      })),
    });
  } catch (e) {
    return dbErrorResponse(e);
  }
}