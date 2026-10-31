// /admin/courses  (Member A) -- course CRUD with instructors; creation goes through create_course().
import { withUser } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import AdminCourses from "./AdminCourses";

export const dynamic = "force-dynamic";

export default async function AdminCoursesPage() {
  const session = await requirePage(["admin"]);
  const data = await withUser(session.user.id, async (c) => ({
    courses: (await c.query("SELECT * FROM v_course_overview ORDER BY code")).rows,
    instructors: (await c.query("SELECT user_id, full_name, email FROM app_user WHERE role = 'instructor' ORDER BY full_name")).rows,
    teaches: (await c.query("SELECT course_id, instructor_id FROM course_instructor")).rows,
  }));

  const courses = data.courses.map((co) => ({
    courseId: co.course_id as number,
    code: co.code as string,
    title: co.title as string,
    semester: co.semester as number,
    lectures: Number(co.lectures),
    indexedLectures: Number(co.indexed_lectures),
    videoHours: String(co.video_hours),
    enrolledStudents: Number(co.enrolled_students),
    instructorIds: data.teaches.filter((t) => t.course_id === co.course_id).map((t) => t.instructor_id as number),
  }));
  const instructors = data.instructors.map((u) => ({ id: u.user_id as number, name: u.full_name as string, email: u.email as string }));

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Courses</h1>
          <p className="muted" style={{ margin: 0 }}>Every course needs at least one instructor. The database enforces it.</p>
        </div>
      </div>
      <AdminCourses courses={courses} instructors={instructors} />
    </main>
  );
}
