// /instructor/courses  (Member A) -- the courses this instructor teaches (admins see all).
import Link from "next/link";
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function MyCoursesPage() {
  const session = await requirePage(["instructor", "admin"]);
  const { id, role } = session.user;
  const courses = await withUser(id, async (c) =>
    (
      await c.query(
        `SELECT v.* FROM v_course_overview v
          WHERE $2 = 'admin'
             OR EXISTS (SELECT 1 FROM course_instructor ci WHERE ci.course_id = v.course_id AND ci.instructor_id = $1)
          ORDER BY v.code`,
        [id, role],
      )
    ).rows,
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My courses</h1>
          <p className="muted" style={{ margin: 0 }}>Add lectures and upload their transcripts to make them searchable.</p>
        </div>
      </div>
      {courses.length === 0 ? (
        <div className="card muted">You are not assigned to any course yet. An admin adds instructors to courses.</div>
      ) : (
        <div className="grid-2">
          {courses.map((co) => (
            <Link key={co.course_id} href={`/instructor/courses/${co.course_id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="stack" style={{ gap: 6 }}>
                <span className="course-code">{co.code}</span>
                <h3>{co.title}</h3>
                <span className="muted small">
                  Semester {co.semester} · {co.lectures} lecture{Number(co.lectures) === 1 ? "" : "s"} · {co.indexed_lectures} searchable · {co.video_hours} h of video
                </span>
                {Number(co.indexed_lectures) < Number(co.lectures) && (
                  <span><span className="badge badge-warn">{Number(co.lectures) - Number(co.indexed_lectures)} need a transcript</span></span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
