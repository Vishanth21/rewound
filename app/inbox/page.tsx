// /inbox  (Member B) -- pending access requests the caller may decide.
//
// The page loads the queue through my_pending_requests(), which already limits rows to
// lectures this instructor uploaded (or everything, for an admin). The client component
// only posts a decision; decide_request() re-checks the same rule in the database, so a
// tampered request id still cannot be approved by the wrong person.
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import Inbox from "./Inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await requirePage(["instructor", "admin"]);

  const requests = await withUser(session.user.id, async (c) =>
    (await c.query("SELECT * FROM my_pending_requests() ORDER BY requested_at")).rows.map((r) => ({
      requestId: r.request_id as number,
      studentName: r.student_name as string,
      courseCode: r.course_code as string,
      lectureNo: r.lecture_no as number,
      lectureTitle: r.lecture_title as string,
      reason: r.reason as string,
      requestedAt: String(r.requested_at),
    })),
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="muted" style={{ margin: 0 }}>
            Students asking for access to your lectures. Approving opens the transcript for a set number of days.
          </p>
        </div>
      </div>
      <Inbox requests={requests} />
    </main>
  );
}