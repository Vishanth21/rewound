// /requests  (Member B) -- the student's request history and derived access state.
//
// Read-only: no client component, no fetch round trip. The page queries v_request_history
// directly under the user's own id, and RLS on access_request decides which rows exist --
// a student sees only their own, an instructor the ones they approve, an admin everything.
// The Access column is computed in SQL (v_request_history.access_state), so an expired
// grant can never look active because a cached status went stale.
import Link from "next/link";
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Row = {
  requestId: number;
  courseCode: string;
  lectureNo: number;
  lectureTitle: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  expiresAt: string | null;
  accessState: "active" | "expired" | null;
};

const BADGE: Record<string, { cls: string; label: string }> = {
  pending: { cls: "badge badge-warn", label: "Pending" },
  rejected: { cls: "badge badge-muted", label: "Declined" },
  active: { cls: "badge badge-ok", label: "Active" },
  expired: { cls: "badge badge-muted", label: "Expired" },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function MyRequestsPage() {
  const session = await requirePage();

  const requests: Row[] = await withUser(session.user.id, async (c) =>
    (
      await c.query(
        `SELECT request_id, course_code, lecture_no, lecture_title,
                requested_at, status, expires_at, access_state
           FROM v_request_history
       ORDER BY requested_at DESC, request_id DESC`,
      )
    ).rows.map((r) => ({
      requestId: r.request_id,
      courseCode: r.course_code,
      lectureNo: r.lecture_no,
      lectureTitle: r.lecture_title,
      requestedAt: r.requested_at,
      status: r.status,
      expiresAt: r.expires_at,
      accessState: r.access_state,
    })),
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My requests</h1>
          <p className="muted" style={{ margin: 0 }}>
            Access you have asked for. An approved request stays open until it expires; after that you can ask again.
          </p>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="card muted">
          Nothing yet. Search for a topic and use <strong>Request access</strong> on a locked result.
        </div>
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Lecture</th>
                <th>Access</th>
                <th>Asked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                // A decided row is immutable, so 'status' alone is enough for pending/rejected;
                // an approval is further split by whether it has run out.
                const key = r.status === "approved" ? r.accessState ?? "expired" : r.status;
                const badge = BADGE[key] ?? BADGE.expired;
                return (
                  <tr key={r.requestId}>
                    <td>
                      <span className="course-code">{r.courseCode}</span>{" "}
                      <span className="muted small">Lecture {r.lectureNo}</span>
                      <div>{r.lectureTitle}</div>
                    </td>
                    <td className="small">
                      {r.status === "approved" && r.accessState === "active" ? (
                        <span className="muted">Open until {r.expiresAt ? fmt(r.expiresAt) : "—"}</span>
                      ) : r.status === "approved" ? (
                        <span className="muted">Expired {r.expiresAt ? fmt(r.expiresAt) : ""}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="small muted">{fmt(r.requestedAt)}</td>
                    <td>
                      <span className={badge.cls}>{badge.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small" style={{ marginTop: 16 }}>
        Looking for something else? <Link href="/search">Search lectures</Link>.
      </p>
    </main>
  );
}