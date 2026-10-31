// /admin/enrollments  (Member B) -- who is enrolled in what, with add and remove.
//
// This is the one admin page that writes, so it is split: the page reads, the client
// component posts. Both go through withUser(), and the database re-checks the role --
// trg_enrollment_role refuses a non-student student_id even if this page had a bug.
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import AdminEnrollments from "./AdminEnrollments";

export const dynamic = "force-dynamic";

export default async function AdminEnrollmentsPage() {
  const session = await requirePage(["admin"]);

  const data = await withUser(session.user.id, async (c) => ({
    // v_course_overview already carries enrolled_students, so the per-course count is a
    // read of A's view rather than a second GROUP BY over enrollment.
    courses: (
      await c.query(
        `SELECT course_id, code, title, semester, enrolled_students
           FROM v_course_overview
       ORDER BY code`,
      )
    ).rows,
    students: (await c.query("SELECT user_id, full_name, email FROM app_user WHERE role = 'student' ORDER BY full_name")).rows,
    enrollments: (
      await c.query(
        `SELECT e.student_id, e.course_id, e.enrolled_at
           FROM enrollment e
       ORDER BY e.enrolled_at DESC`,
      )
    ).rows,
  }));

  const courses = data.courses.map((r) => ({
    courseId: r.course_id as number,
    code: r.code as string,
    title: r.title as string,
    semester: Number(r.semester),
    enrolled: Number(r.enrolled_students),
  }));
  const students = data.students.map((r) => ({ id: r.user_id as number, name: r.full_name as string, email: r.email as string }));
  const enrollments = data.enrollments.map((r) => ({
    studentId: r.student_id as number,
    courseId: r.course_id as number,
  }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Enrollments</h1>
          <p className="muted" style={{ margin: 0 }}>
            A student sees a lecture only through an enrollment or an approved request. Removing one takes effect immediately.
          </p>
        </div>
      </div>
      <AdminEnrollments courses={courses} students={students} enrollments={enrollments} />
    </main>
  );
}