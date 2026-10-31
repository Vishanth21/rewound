// POST /api/requests/:id/decision   body { approve: boolean, days?: number }
// Approve (granting access for `days` days) or reject a pending request.
//
// The whole rule set lives in decide_request(): it validates the 1-90 day window,
// takes FOR UPDATE on the row, and trg_request_before_update refuses a second decision
// and rejects anyone who is neither the lecture's uploader nor an admin. This route
// only parses the body and maps the SQLSTATEs, so a bug here cannot approve anything
// the database would not approve.
import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { parseId } from "@/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Decision = z.object({
  approve: z.boolean(),
  // Only meaningful when approving; 7 is the database's own default.
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;

  const id = parseId(params.id);
  if (!id) return badRequest("Invalid request id.");

  const parsed = Decision.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0].message);
  const { approve, days } = parsed.data;

  try {
    await withUser(session.user.id, async (c) => {
      // CALL, not SELECT: decide_request is a procedure.
      await c.query("CALL decide_request($1, $2, $3)", [id, approve, days]);
    });
    return Response.json({ ok: true, status: approve ? "approved" : "rejected" });
  } catch (e) {
    // 42501 "may not decide request"      -> 403
    // P0002 request not found             -> 404
    // 23514 "was already approved" / bad  -> 422
    //       duration
    return dbErrorResponse(e);
  }
}