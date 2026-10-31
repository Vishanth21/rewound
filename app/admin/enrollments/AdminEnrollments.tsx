"use client";
// Add / remove enrollments. Two controls: a course picker that lists its current students
// with a Remove button each, and a small form to add one student to one course.
//
// The list is a plain (student, course) pair table -- there is no soft delete, because the
// access rules read `enrollment` directly, so a removed row must stop granting access at
// once rather than leaving a flag behind for something else to forget to check.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Course = { courseId: number; code: string; title: string; semester: number; enrolled: number };
type Student = { id: number; name: string; email: string };
type Pair = { studentId: number; courseId: number };

export default function AdminEnrollments({
  courses,
  students,
  enrollments,
}: {
  courses: Course[];
  students: Student[];
  enrollments: Pair[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [courseId, setCourseId] = useState<number>(courses[0]?.courseId ?? 0);
  const [addCourseId, setAddCourseId] = useState<string>(courses[0] ? String(courses[0].courseId) : "");
  const [addStudentId, setAddStudentId] = useState<string>("");

  const nameOf = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const enrolledIn = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const p of enrollments) map.set(p.courseId, [...(map.get(p.courseId) ?? []), p.studentId]);
    return map;
  }, [enrollments]);

  // Only students who are not already in the selected course: the PK would reject a
  // duplicate anyway, but offering it and then failing is a worse experience.
  const addable = useMemo(() => {
    const id = Number(addCourseId);
    const taken = new Set(enrolledIn.get(id) ?? []);
    return students.filter((s) => !taken.has(s.id));
  }, [addCourseId, enrolledIn, students]);

  async function send(method: "POST" | "DELETE", body: { studentId: number; courseId: number }, key: string) {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/enrollments", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Could not change the enrollment." });
        return;
      }
      const who = nameOf.get(body.studentId)?.name ?? "Student";
      const course = courses.find((c) => c.courseId === body.courseId)?.code ?? "";
      setMsg({ ok: true, text: method === "POST" ? `Enrolled ${who} in ${course}.` : `Removed ${who} from ${course}.` });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const current = courses.find((c) => c.courseId === courseId);
  const roster = (enrolledIn.get(courseId) ?? [])
    .map((id) => nameOf.get(id))
    .filter((s): s is Student => Boolean(s))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="stack">
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-error"}`}>{msg.text}</div>}

      <div className="card">
        <h2>Add a student to a course</h2>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <span className="small muted">Course</span>
            <select
              value={addCourseId}
              onChange={(e) => {
                setAddCourseId(e.target.value);
                setAddStudentId("");
              }}
            >
              {courses.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="small muted">Student</span>
            <select value={addStudentId} onChange={(e) => setAddStudentId(e.target.value)}>
              <option value="">Pick a student…</option>
              {addable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email})
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={!addCourseId || !addStudentId || busy !== null}
            onClick={() => {
              const body = { studentId: Number(addStudentId), courseId: Number(addCourseId) };
              setAddStudentId("");
              void send("POST", body, `add-${body.studentId}-${body.courseId}`);
            }}
          >
            {busy?.startsWith("add-") ? "Working…" : "Enroll"}
          </button>
        </div>
        {addable.length === 0 && students.length > 0 && (
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            Every student is already enrolled in this course.
          </p>
        )}
      </div>

      <div className="card">
        <div className="result-head">
          <h2 style={{ margin: 0 }}>Roster</h2>
          <label className="row" style={{ gap: 6 }}>
            <span className="small muted">Course</span>
            <select value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
              {courses.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          {current ? `${current.enrolled} enrolled in ${current.code}.` : "No courses yet."}
        </p>

        {roster.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nobody is enrolled in this course yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Email</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td className="small muted">{s.email}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-sm btn-danger"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void send("DELETE", { studentId: s.id, courseId }, `del-${s.id}-${courseId}`)}
                      >
                        {busy === `del-${s.id}-${courseId}` ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
