// /admin/requests  (Member B) -- every access request, in any state, with its decision.
//
// This reads v_request_history, the same view /requests uses, but as an admin: RLS's
// can_see_request() returns true for admins, so the rows are not filtered. The page is
// read-only -- deciding happens in /inbox, through decide_request(), which is the one
// path that locks the row. A second decision button here would be a second path to keep
// correct, so there isn't one.
import Link from "next/link";
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Status = "pending" | "approved" | "rejected";

type Row = {
  requestId: number;
  studentName: string;
  courseCode: string;
  lectureNo: number;
  lectureTitle: string;
  requestedAt: string;
  status: Status;
  expiresAt: string | null;
  accessState: "active" | "expired" | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

const BADGE: Record<string, { cls: string; label: string }> = {
  pending: { cls: "badge badge-warn", label: "Pending" },
  rejected: { cls: "badge badge-muted", label: "Declined" },
  active: { cls: "badge badge-ok", label: "Active" },
  expired: { cls: "badge badge-muted", label: "Expired" },
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const session = await requirePage(["admin"]);

  // The filter is a UI convenience only: the view already returns everything the caller
  // may see, so an unexpected value just shows all rows instead of widening access.
  const wanted = searchParams.status;
  const filter: Status | null = wanted === "pending" || wanted === "approved" || wanted === "rejected" ? wanted : null;

  const rows: Row[] = await withUser(session.user.id, async (c) =>
    (
      await c.query(
        `SELECT r.request_id, s.full_name AS student_name,
                r.course_code, r.lecture_no, r.lecture_title,
                r.requested_at, r.status, r.expires_at, r.access_state,
                d.full_name AS decided_by, a.decided_at
           FROM v_request_history r
           JOIN      app_user       s ON s.user_id    = r.student_id
           LEFT JOIN access_request a ON a.request_id = r.request_id
           LEFT JOIN app_user       d ON d.user_id    = a.decided_by
          WHERE ($1::request_status IS NULL OR r.status = $1)
       ORDER BY r.requested_at DESC, r.request_id DESC`,
        [filter],
      )
    ).rows.map((r) => ({
      requestId: r.request_id,
      studentName: r.student_name,
      courseCode: r.course_code,
      lectureNo: r.lecture_no,
      lectureTitle: r.lecture_title,
      requestedAt: r.requested_at,
      status: r.status,
      expiresAt: r.expires_at,
      accessState: r.access_state,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at,
    })),
  );

  const counts = await withUser(session.user.id, async (c) =>
    (
      await c.query(
        `SELECT status, count(*) AS n
           FROM access_request
       GROUP BY status`,
      )
    ).rows.reduce(
      (acc, r) => ({ ...acc, [String(r.status)]: Number(r.n) }),
      {} as Record<string, number>,
    ),
  );

  const tabs: { key: string; label: string; n: number | null }[] = [
    { key: "", label: "All", n: null },
    { key: "pending", label: "Pending", n: counts.pending ?? 0 },
    { key: "approved", label: "Approved", n: counts.approved ?? 0 },
    { key: "rejected", label: "Declined", n: counts.rejected ?? 0 },
  ];

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Access requests</h1>
          <p className="muted" style={{ margin: 0 }}>
            Every request in the system. Decisions are made in the{" "}
            <Link href="/inbox">inbox</Link>, where the database serialises them.
          </p>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 16 }}>
        {tabs.map((t) => {
          const active = (filter ?? "") === t.key;
          return (
            <Link
              key={t.key || "all"}
              href={t.key ? `/admin/requests?status=${t.key}` : "/admin/requests"}
              aria-pressed={active}
              style={{
                padding: "8px 14px",
                fontSize: "0.88rem",
                color: active ? "#fff" : "var(--muted)",
                background: active ? "var(--brand)" : "var(--surface)",
              }}
            >
              {t.label}
              {t.n !== null ? ` (${t.n})` : ""}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="card muted">
          No {filter ? `${filter} ` : ""}requests. Students create them from a locked search result.
        </div>
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Lecture</th>
                <th>Asked</th>
                <th>Status</th>
                <th>Decided by</th>
                <th>Access until</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = r.status === "approved" ? r.accessState ?? "expired" : r.status;
                const badge = BADGE[key] ?? BADGE.expired;
                return (
                  <tr key={r.requestId}>
                    <td>
                      <strong>{r.studentName}</strong>
                    </td>
                    <td>
                      <span className="course-code">{r.courseCode}</span>{" "}
                      <span className="muted small">Lecture {r.lectureNo}</span>
                      <div className="small">{r.lectureTitle}</div>
                    </td>
                    <td className="small muted">{fmt(r.requestedAt)}</td>
                    <td>
                      <span className={badge.cls}>{badge.label}</span>
                    </td>
                    <td className="small">
                      {r.decidedBy ? (
                        <>
                          {r.decidedBy}
                          <div className="muted">{fmt(r.decidedAt)}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="small">
                      {r.status === "approved" && r.expiresAt ? (
                        <span className={r.accessState === "active" ? "" : "muted"}>{fmt(r.expiresAt)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}