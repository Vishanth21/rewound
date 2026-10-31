// POST /api/analytics   refresh mv_daily_course_searches
//
// A materialized view can only be refreshed by its owner, and the app connects as
// lecturelens_app -- not the owner. refresh_daily_searches() is SECURITY DEFINER, so it
// runs with the owner's rights and the app can call it; the grant is in 120_grants_content.sql.
// No user id is trusted here beyond the session: the function itself takes no parameters
// and touches no row-level data, so there is nothing for a malicious caller to aim at.
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { dbErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  // Admin-only: this is a global, all-users operation, not a per-user read.
  const session = await requireApi(["admin"]);
  if (isResponse(session)) return session;

  try {
    await withUser(session.user.id, async (c) => {
      await c.query("SELECT refresh_daily_searches()");
    });
    return Response.json({ ok: true });
  } catch (e) {
    return dbErrorResponse(e);
  }
}