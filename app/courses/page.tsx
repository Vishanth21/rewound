import Link from "next/link";
import { requirePage } from "@/lib/guard";
import { withUser } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StudentCoursesPage() {
  const session = await requirePage(["student"]);
  const { rows: courses } = await withUser(session.user.id, async (c) =>
    c.query(
      `SELECT co.course_id, co.code, co.title, co.semester, count(l.lecture_id)::int AS lecture_count
         FROM enrollment e
         JOIN course co ON co.course_id = e.course_id
         LEFT JOIN lecture l ON l.course_id = co.course_id
        WHERE e.student_id = $1
        GROUP BY co.course_id
        ORDER BY co.code`,
      [session.user.id],
    ),
  );

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>My courses</h1>
          <p className="muted" style={{ margin: 0 }}>Courses you are enrolled in.</p>
        </div>
      </div>
      {courses.length === 0 ? (
        <div className="card muted">You are not enrolled in any courses yet.</div>
      ) : (
        <div className="stack">
          {courses.map((course) => (
            <Link key={course.course_id} href={`/courses/${course.course_id}`} className="card row" style={{ justifyContent: "space-between", textDecoration: "none" }}>
              <div>
                <p className="muted small" style={{ margin: 0 }}>Semester {course.semester}</p>
                <h2 style={{ margin: 0 }}><span className="course-code">{course.code}</span>{course.title}</h2>
              </div>
              <span className="muted small">{course.lecture_count} {course.lecture_count === 1 ? "lecture" : "lectures"} →</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
