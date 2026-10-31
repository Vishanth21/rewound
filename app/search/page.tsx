// /search  (Member A) -- every role. The course filter lists the courses in the user's own scope.
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import SearchClient from "./SearchClient";

export const dynamic = "force-dynamic";

const COURSES_SQL = {
  admin: "SELECT code FROM course ORDER BY code",
  instructor: `SELECT co.code FROM course co JOIN course_instructor ci ON ci.course_id = co.course_id
               WHERE ci.instructor_id = $1 ORDER BY co.code`,
  student: `SELECT co.code FROM course co JOIN enrollment e ON e.course_id = co.course_id
            WHERE e.student_id = $1 ORDER BY co.code`,
};

export default async function SearchPage({ searchParams }: { searchParams: { q?: string; mode?: string; course?: string } }) {
  const session = await requirePage();
  const { role, id } = session.user;
  const courses = await withUser(id, async (c) => {
    const sql = COURSES_SQL[role];
    return (await c.query(sql, role === "admin" ? [] : [id])).rows.map((r) => r.code as string);
  });

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Search lectures</h1>
          <p className="muted" style={{ margin: 0 }}>
            Ask a question in your own words. Results jump straight to the moment it is explained.
          </p>
        </div>
      </div>
      <SearchClient
        role={role}
        courses={courses}
        initial={{
          q: searchParams.q ?? "",
          mode: searchParams.mode === "keyword" ? "keyword" : "semantic",
          course: searchParams.course ?? "",
        }}
      />
    </main>
  );
}
