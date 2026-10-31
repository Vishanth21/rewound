// lib/manage.ts  (Member A)
// "May this user manage this course/lecture?" checks for route handlers. The database repeats
// the same rules (fn_can_manage_lecture, course_lectures, triggers), so this is only the early,
// friendly layer.
import type { PoolClient } from "pg";
import type { Session } from "@/lib/auth";

export async function canManageCourse(c: PoolClient, s: Session, courseId: number): Promise<boolean> {
  if (s.user.role === "admin") return true;
  if (s.user.role !== "instructor") return false;
  const r = await c.query("SELECT 1 FROM course_instructor WHERE course_id = $1 AND instructor_id = $2", [courseId, s.user.id]);
  return r.rowCount === 1;
}

export async function canManageLecture(c: PoolClient, s: Session, lectureId: number): Promise<boolean> {
  if (s.user.role === "admin") return true;
  if (s.user.role !== "instructor") return false;
  const r = await c.query(
    `SELECT 1 FROM lecture l JOIN course_instructor ci ON ci.course_id = l.course_id
      WHERE l.lecture_id = $1 AND ci.instructor_id = $2`,
    [lectureId, s.user.id],
  );
  return r.rowCount === 1;
}

export const parseId = (raw: string): number | null => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);
