// /instructor/courses/:id  (Member A) -- lecture CRUD and transcript upload for one course.
import Link from "next/link";
import { notFound } from "next/navigation";
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { canManageCourse, parseId } from "@/lib/manage";
import CourseManager from "./CourseManager";

export const dynamic = "force-dynamic";

export default async function CourseManagePage({ params }: { params: { id: string } }) {
  const session = await requirePage(["instructor", "admin"]);
  const id = parseId(params.id);
  if (!id) notFound();

  const { course, allowed } = await withUser(session.user.id, async (c) => ({
    course: (await c.query("SELECT course_id, code, title, semester FROM course WHERE course_id = $1", [id])).rows[0],
    allowed: await canManageCourse(c, session, id),
  }));
  if (!course) notFound();
  if (!allowed) {
    return (
      <main>
        <div className="card stack">
          <h1>You don’t teach {course.code}</h1>
          <p className="muted" style={{ margin: 0 }}>Only the course’s instructors and admins can manage its lectures.</p>
          <div><Link className="btn" href="/instructor/courses">Back to my courses</Link></div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <p className="muted small" style={{ margin: 0 }}>Semester {course.semester}</p>
          <h1><span className="course-code">{course.code}</span>{course.title}</h1>
        </div>
        <Link className="btn" href={session.user.role === "admin" ? "/admin/courses" : "/instructor/courses"}>← Courses</Link>
      </div>
      <CourseManager courseId={id} canUpload={session.user.role === "instructor"} />
    </main>
  );
}
