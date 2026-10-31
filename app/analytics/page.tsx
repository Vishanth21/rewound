// /analytics  (Member B) -- the admin dashboard.
//
// Everything here reads a view that already aggregates in SQL, so the page never loads raw
// rows and adds them up in JavaScript. Two of the views are Member A's (search activity,
// unanswered queries, the daily MV); the access-demand views are from 091_analytics_access.sql.
// The app role has no SELECT on search_log/search_hit at all, so these views are the only
// way the dashboard can see search behaviour -- that is intentional.
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import RefreshSearches from "./RefreshSearches";

export const dynamic = "force-dynamic";

type Demand = {
  code: string;
  title: string;
  totalRequests: number;
  pending: number;
  approved: number;
  rejected: number;
  approvalRatePct: string | null;
  avgHoursToDecide: string | null;
  distinctRequesters: number;
};

type SearchActivity = {
  code: string;
  title: string;
  searchesMatched: number;
  distinctSearchers: number;
  inScopeHits: number;
  lockedHits: number;
};

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));

export default async function AnalyticsPage() {
  const session = await requirePage(["admin"]);

  const data = await withUser(session.user.id, async (c) => {
    const demand = await c.query("SELECT * FROM v_course_access_demand ORDER BY total_requests DESC, code");
    const activity = await c.query("SELECT * FROM v_course_search_activity ORDER BY searches_matched DESC, code");
    const unanswered = await c.query("SELECT * FROM v_unanswered_queries ORDER BY times_asked DESC, query LIMIT 15");
    const trend = await c.query(
      `SELECT d.day, co.code, d.searches
         FROM mv_daily_course_searches d
         JOIN course co ON co.course_id = d.course_id
        WHERE d.day > current_date - interval '14 days'
        ORDER BY d.day DESC, co.code`,
    );
    const approvers = await c.query("SELECT * FROM v_pending_by_approver ORDER BY pending DESC, full_name");
    const totals = await c.query(
      `SELECT (SELECT count(*) FROM access_request)                       AS requests,
              (SELECT count(*) FROM access_request WHERE status = 'pending') AS pending,
              (SELECT count(*) FROM app_user)                            AS users,
              (SELECT count(*) FROM app_user WHERE role = 'student')     AS students,
              (SELECT count(*) FROM enrollment)                          AS enrollments`,
    );
    return {
      demand: demand.rows,
      activity: activity.rows,
      unanswered: unanswered.rows,
      trend: trend.rows,
      approvers: approvers.rows,
      totals: totals.rows[0] ?? {},
    };
  });

  const demand: Demand[] = data.demand.map((r) => ({
    code: r.code as string,
    title: r.title as string,
    totalRequests: num(r.total_requests),
    pending: num(r.pending),
    approved: num(r.approved),
    rejected: num(r.rejected),
    approvalRatePct: str(r.approval_rate_pct),
    avgHoursToDecide: str(r.avg_hours_to_decide),
    distinctRequesters: num(r.distinct_requesters),
  }));

  const activity: SearchActivity[] = data.activity.map((r) => ({
    code: r.code as string,
    title: r.title as string,
    searchesMatched: num(r.searches_matched),
    distinctSearchers: num(r.distinct_searchers),
    inScopeHits: num(r.in_scope_hits),
    lockedHits: num(r.locked_hits),
  }));

  const totalRequests = num(data.totals.requests);
  const pending = num(data.totals.pending);

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted" style={{ margin: 0 }}>
            Access demand, search behaviour and content gaps, aggregated in SQL.
          </p>
        </div>
        <RefreshSearches />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="muted small">Access requests</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{totalRequests}</div>
          <div className="muted small">{pending} still pending</div>
        </div>
        <div className="card">
          <div className="muted small">Users</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{num(data.totals.users)}</div>
          <div className="muted small">{num(data.totals.students)} students</div>
        </div>
        <div className="card">
          <div className="muted small">Enrollments</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{num(data.totals.enrollments)}</div>
          <div className="muted small">student-course pairs</div>
        </div>
        <div className="card">
          <div className="muted small">Courses with demand</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{demand.length}</div>
          <div className="muted small">courses that received requests</div>
        </div>
      </div>

      <h2>Access demand by course</h2>
      <div className="card table-wrap" style={{ marginBottom: 20 }}>
        {demand.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No access requests yet. Approvals show up here as students ask for lectures outside their courses.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Requests</th>
                <th>Pending</th>
                <th>Approved</th>
                <th>Declined</th>
                <th>Approval rate</th>
                <th>Avg hours to decide</th>
                <th>Distinct students</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((d) => (
                <tr key={d.code}>
                  <td>
                    <span className="course-code">{d.code}</span>
                    <div className="muted small">{d.title}</div>
                  </td>
                  <td className="mono">{d.totalRequests}</td>
                  <td className="mono">{d.pending > 0 ? <span className="badge badge-warn">{d.pending}</span> : 0}</td>
                  <td className="mono">{d.approved}</td>
                  <td className="mono">{d.rejected}</td>
                  <td className="mono">{d.approvalRatePct == null ? <span className="muted">—</span> : `${d.approvalRatePct}%`}</td>
                  <td className="mono">{d.avgHoursToDecide == null ? <span className="muted">—</span> : d.avgHoursToDecide}</td>
                  <td className="mono">{d.distinctRequesters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Search activity, last 30 days</h2>
      <div className="card table-wrap" style={{ marginBottom: 20 }}>
        {activity.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No searches recorded in the last 30 days.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Matched searches</th>
                <th>Distinct searchers</th>
                <th>In-scope hits</th>
                <th>Locked hits</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.code}>
                  <td>
                    <span className="course-code">{a.code}</span>
                    <div className="muted small">{a.title}</div>
                  </td>
                  <td className="mono">{a.searchesMatched}</td>
                  <td className="mono">{a.distinctSearchers}</td>
                  <td className="mono">{a.inScopeHits}</td>
                  <td className="mono">
                    {a.lockedHits > 0 ? <span className="badge badge-lock">{a.lockedHits}</span> : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid-2">
        <div>
          <h2>Content gaps</h2>
          <div className="card table-wrap">
            {data.unanswered.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Every repeated query matched something. Nothing to fill in.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Query asked, no hits</th>
                    <th>Times</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unanswered.map((u) => (
                    <tr key={String(u.query)}>
                      <td>{String(u.query)}</td>
                      <td className="mono">{num(u.times_asked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <h2>Pending by approver</h2>
          <div className="card table-wrap">
            {data.approvers.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No pending requests waiting on anyone.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Approver</th>
                    <th>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.approvers.map((a) => (
                    <tr key={String(a.approver_id)}>
                      <td>{String(a.full_name)}</td>
                      <td className="mono">
                        <span className="badge badge-warn">{num(a.pending)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: 20 }}>Daily searches, last 14 days</h2>
      <div className="card table-wrap">
        {data.trend.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            The materialised view is empty. Press “Refresh search trend” after the first searches are logged.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Course</th>
                <th>Searches</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((t, i) => (
                <tr key={`${String(t.day)}-${String(t.code)}-${i}`}>
                  <td>{new Date(String(t.day)).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                  <td>
                    <span className="course-code">{String(t.code)}</span>
                  </td>
                  <td className="mono">{num(t.searches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}