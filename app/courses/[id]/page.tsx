import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/guard";
import { withUser } from "@/lib/db";
import { parseId } from "@/lib/manage";

export const dynamic = "force-dynamic";

export default async function StudentCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["student"]);
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) notFound();

  const data = await withUser(session.user.id, async (c) => {
    const course = (await c.query(
      `SELECT co.course_id, co.code, co.title, co.semester
         FROM course co
         JOIN enrollment e ON e.course_id = co.course_id
        WHERE co.course_id = $1 AND e.student_id = $2`,
      [id, session.user.id],
    )).rows[0];
    if (!course) return null;

    const lectures = (await c.query(
      `SELECT l.lecture_id, l.lecture_no, l.title, l.duration_sec,
              EXISTS (SELECT 1 FROM get_lecture(l.lecture_id) LIMIT 1) AS has_transcript
         FROM lecture l
        WHERE l.course_id = $1
        ORDER BY l.lecture_no`,
      [id],
    )).rows;
    return { course, lectures };
  });

  if (!data) notFound();

  return (
    <main>
      <div className="page-head">
        <div>
          <p className="muted small" style={{ margin: 0 }}>Semester {data.course.semester}</p>
          <h1><span className="course-code">{data.course.code}</span>{data.course.title}</h1>
        </div>
        <Link className="btn" href="/courses">← My courses</Link>
      </div>
      {data.lectures.length === 0 ? (
        <div className="card muted">No lectures have been added to this course yet.</div>
      ) : (
        <div className="card stack">
          {data.lectures.map((lecture) => (
            <div key={lecture.lecture_id} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div>
                <span className="muted small">Lecture {lecture.lecture_no} · {Math.floor(Number(lecture.duration_sec) / 60)} min</span>
                <div>
                  {lecture.has_transcript ? (
                    <Link href={`/lectures/${lecture.lecture_id}`}>{lecture.title}</Link>
                  ) : (
                    <span>{lecture.title}</span>
                  )}
                </div>
              </div>
              <span className={`badge ${lecture.has_transcript ? "badge-ok" : "badge-muted"}`}>
                {lecture.has_transcript ? "Transcript available" : "Transcript not available"}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
