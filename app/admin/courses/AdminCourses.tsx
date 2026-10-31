"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Course = {
  courseId: number;
  code: string;
  title: string;
  semester: number;
  lectures: number;
  indexedLectures: number;
  videoHours: string;
  enrolledStudents: number;
  instructorIds: number[];
};
type Instructor = { id: number; name: string; email: string };
type Form = { code: string; title: string; semester: string; instructorIds: number[] };

export default function AdminCourses({ courses, instructors }: { courses: Course[]; instructors: Instructor[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Form>({ code: "", title: "", semester: "1", instructorIds: [] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const nameOf = (id: number) => instructors.find((i) => i.id === id)?.name ?? `#${id}`;

  function open(c: Course | null) {
    setMsg(null);
    if (c) {
      setForm({ code: c.code, title: c.title, semester: String(c.semester), instructorIds: c.instructorIds });
      setEditing(c.courseId);
    } else {
      setForm({ code: "", title: "", semester: "1", instructorIds: [] });
      setEditing("new");
    }
  }

  function toggle(id: number) {
    setForm((f) => ({ ...f, instructorIds: f.instructorIds.includes(id) ? f.instructorIds.filter((x) => x !== id) : [...f.instructorIds, id] }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.instructorIds.length === 0) {
      setMsg({ ok: false, text: "Pick at least one instructor." });
      return;
    }
    setSaving(true);
    const isNew = editing === "new";
    const res = await fetch(isNew ? "/api/courses" : `/api/courses/${editing}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isNew
          ? { code: form.code, title: form.title, semester: Number(form.semester), instructorIds: form.instructorIds }
          : { title: form.title, semester: Number(form.semester), instructorIds: form.instructorIds },
      ),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: body.error ?? "Could not save the course." });
      return;
    }
    setMsg({ ok: true, text: isNew ? `Course ${form.code.toUpperCase()} created.` : "Course updated." });
    setEditing(null);
    router.refresh();
  }

  async function remove(c: Course) {
    if (!confirm(`Delete ${c.code}? Its ${c.lectures} lecture(s), transcripts, enrollments and access requests are deleted too.`)) return;
    const res = await fetch(`/api/courses/${c.courseId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: `${c.code} deleted.` } : { ok: false, text: body.error ?? "Could not delete." });
    router.refresh();
  }

  return (
    <div className="stack">
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-error"}`}>{msg.text}</div>}

      {editing !== null ? (
        <form className="card stack" onSubmit={save}>
          <h2 style={{ margin: 0 }}>{editing === "new" ? "New course" : `Edit ${form.code}`}</h2>
          <div className="grid-2">
            <label>
              <span>Code</span>
              <input type="text" required maxLength={12} placeholder="CS301" value={form.code} disabled={editing !== "new"}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </label>
            <label>
              <span>Title</span>
              <input type="text" required maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              <span>Semester</span>
              <select value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
            <legend className="small muted" style={{ padding: "0 4px" }}>Instructors (at least one)</legend>
            {instructors.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>No instructor accounts exist yet.</p>
            ) : (
              <div className="grid-2" style={{ gap: 6 }}>
                {instructors.map((i) => (
                  <label key={i.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, color: "var(--text)" }}>
                    <input type="checkbox" checked={form.instructorIds.includes(i.id)} onChange={() => toggle(i.id)} />
                    {i.name} <span className="muted small">{i.email}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editing === "new" ? "Create course" : "Save changes"}</button>
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div><button className="btn btn-primary" type="button" onClick={() => open(null)}>+ New course</button></div>
      )}

      <div className="card table-wrap" style={{ padding: "6px 12px" }}>
        {courses.length === 0 ? (
          <p className="muted">No courses yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Sem</th>
                <th>Instructors</th>
                <th>Lectures</th>
                <th>Students</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.courseId}>
                  <td><span className="course-code">{c.code}</span>{c.title}</td>
                  <td>{c.semester}</td>
                  <td>{c.instructorIds.map(nameOf).join(", ")}</td>
                  <td>
                    {c.lectures} <span className="muted small">({c.indexedLectures} searchable, {c.videoHours} h)</span>
                  </td>
                  <td>{c.enrolledStudents}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                      <Link className="btn btn-sm" href={`/instructor/courses/${c.courseId}`}>Lectures</Link>
                      <button className="btn btn-sm" type="button" onClick={() => open(c)}>Edit</button>
                      <button className="btn btn-sm btn-danger" type="button" onClick={() => remove(c)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
