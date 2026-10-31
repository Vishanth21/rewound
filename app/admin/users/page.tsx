// /admin/users  (Member B) -- every account, its role and what it is enrolled in.
//
// Read-only on purpose. Creating a user means generating a bcrypt hash, which the app
// does in Node (bcryptjs) and the database CHECK re-verifies as `$2[aby]$NN$...`; that
// belongs with the auth work, not this listing. Roles are shown as a badge so an admin
// can confirm the seeds landed correctly.
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";

export const dynamic = "force-dynamic";

type Role = "student" | "instructor" | "admin";

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  courses: number;
  enrollments: number;
};

const ROLE_BADGE: Record<Role, string> = {
  admin: "badge badge-lock",
  instructor: "badge badge-ok",
  student: "badge badge-muted",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function AdminUsersPage() {
  const session = await requirePage(["admin"]);

  // One query, two LEFT JOINs: counting in SQL keeps this a single round trip and stops
  // a student with three courses turning into three rows in the table.
  const users: UserRow[] = await withUser(session.user.id, async (c) =>
    (
      await c.query(
        `SELECT u.user_id, u.full_name, u.email, u.role, u.created_at,
                (SELECT count(*) FROM course_instructor ci WHERE ci.instructor_id = u.user_id) AS courses,
                (SELECT count(*) FROM enrollment e WHERE e.student_id = u.user_id)             AS enrollments
           FROM app_user u
       ORDER BY u.role, u.full_name`,
      )
    ).rows.map((r) => ({
      id: r.user_id,
      name: r.full_name,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
      courses: Number(r.courses),
      enrollments: Number(r.enrollments),
    })),
  );

  const counts = users.reduce(
    (acc, u) => ({ ...acc, [u.role]: (acc[u.role] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="muted" style={{ margin: 0 }}>
            {users.length} account{users.length === 1 ? "" : "s"}: {counts.student ?? 0} students,{" "}
            {counts.instructor ?? 0} instructors, {counts.admin ?? 0} admins.
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="card muted">No accounts yet. Run the seed migrations to create the demo users.</div>
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Teaching</th>
                <th>Enrolled</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                  </td>
                  <td className="small muted">{u.email}</td>
                  <td>
                    <span className={ROLE_BADGE[u.role]}>{u.role}</span>
                  </td>
                  <td className="mono">{u.role === "instructor" ? u.courses : <span className="muted">—</span>}</td>
                  <td className="mono">{u.role === "student" ? u.enrollments : <span className="muted">—</span>}</td>
                  <td className="small muted">{fmt(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}