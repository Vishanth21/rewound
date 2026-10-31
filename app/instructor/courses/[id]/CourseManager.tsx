"use client";
// Lecture list with transcript status, add/edit/delete lectures, upload .srt/.vtt (Member A).
// Upload = chunk in the database (ingest_transcript) + embed in Node (set_chunk_embeddings).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { mmss, parseDuration } from "@/lib/format";

type Lecture = {
  lecture_id: number;
  lecture_no: number;
  title: string;
  youtube_video_id: string;
  duration_sec: number;
  delivered_on: string | null;
  description: string | null;
  transcript_status: "chunked" | "indexed" | null;
  chunk_count: string;
  embedded_chunks: string;
  uploaded_by_name: string | null;
  uploaded_at: string | null;
};
type Form = { lectureNo: string; title: string; video: string; duration: string; deliveredOn: string; description: string };
type Msg = { ok: boolean; text: string } | null;

const emptyForm = (no: number): Form => ({ lectureNo: String(no), title: "", video: "", duration: "", deliveredOn: "", description: "" });
const toForm = (l: Lecture): Form => ({
  lectureNo: String(l.lecture_no),
  title: l.title,
  video: l.youtube_video_id.trim(),
  duration: mmss(l.duration_sec),
  deliveredOn: l.delivered_on ? String(l.delivered_on).slice(0, 10) : "",
  description: l.description ?? "",
});

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
  return { ok: res.ok, body };
}

export default function CourseManager({ courseId, canUpload }: { courseId: number; canUpload: boolean }) {
  const [lectures, setLectures] = useState<Lecture[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm(1));
  const [busy, setBusy] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<number | null>(null);

  const load = useCallback(async () => {
    const r = await call(`/api/courses/${courseId}/lectures`);
    if (r.ok) setLectures(r.body.lectures as Lecture[]);
    else setMsg({ ok: false, text: String(r.body.error) });
  }, [courseId]);
  useEffect(() => {
    load();
  }, [load]);

  const nextNo = (lectures ?? []).reduce((m, l) => Math.max(m, l.lecture_no), 0) + 1;
  const setBusyFor = (id: number, text: string | null) =>
    setBusy((b) => {
      const n = { ...b };
      if (text) n[id] = text;
      else delete n[id];
      return n;
    });

  async function saveLecture(e: React.FormEvent) {
    e.preventDefault();
    const durationSec = parseDuration(form.duration);
    if (!durationSec) {
      setMsg({ ok: false, text: "Duration must look like 52:30 or 3150 (seconds)." });
      return;
    }
    const payload = {
      lectureNo: Number(form.lectureNo),
      title: form.title,
      video: form.video,
      durationSec,
      deliveredOn: form.deliveredOn || null,
      description: form.description.trim() || null,
    };
    const r =
      editing === "new"
        ? await call(`/api/courses/${courseId}/lectures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await call(`/api/lectures/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) {
      setMsg({ ok: false, text: String(r.body.error) });
      return;
    }
    setMsg({ ok: true, text: editing === "new" ? "Lecture added. Upload its transcript to make it searchable." : "Lecture updated." });
    setEditing(null);
    load();
  }

  async function deleteLecture(l: Lecture) {
    if (!confirm(`Delete Lecture ${l.lecture_no} “${l.title}”? Its transcript, passages and access requests are deleted too.`)) return;
    const r = await call(`/api/lectures/${l.lecture_id}`, { method: "DELETE" });
    setMsg(r.ok ? { ok: true, text: "Lecture deleted." } : { ok: false, text: String(r.body.error) });
    load();
  }

  async function upload(file: File) {
    const id = uploadFor.current;
    if (!id) return;
    setBusyFor(id, "Uploading, chunking and embedding…");
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const r = await call(`/api/lectures/${id}/transcript`, { method: "POST", body: fd });
    setBusyFor(id, null);
    if (!r.ok) setMsg({ ok: false, text: String(r.body.error) });
    else if (r.body.warning) setMsg({ ok: false, text: String(r.body.warning) });
    else setMsg({ ok: true, text: `Transcript indexed: ${r.body.cues} captions packed into ${r.body.chunks} searchable passages.` });
    load();
  }

  async function reembed(l: Lecture) {
    setBusyFor(l.lecture_id, "Re-embedding…");
    const r = await call(`/api/lectures/${l.lecture_id}/reembed`, { method: "POST" });
    setBusyFor(l.lecture_id, null);
    setMsg(r.ok ? { ok: true, text: `Re-embedded ${r.body.chunks} passages.` } : { ok: false, text: String(r.body.error) });
    load();
  }

  async function deleteTranscript(l: Lecture) {
    if (!confirm(`Remove the transcript of “${l.title}”? The lecture stops appearing in search.`)) return;
    const r = await call(`/api/lectures/${l.lecture_id}/transcript`, { method: "DELETE" });
    setMsg(r.ok ? { ok: true, text: "Transcript removed." } : { ok: false, text: String(r.body.error) });
    load();
  }

  const f = (k: keyof Form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }) });

  const editor = (
    <form className="card stack" onSubmit={saveLecture}>
      <h2 style={{ margin: 0 }}>{editing === "new" ? "Add a lecture" : "Edit lecture"}</h2>
      <div className="grid-2">
        <label><span>Lecture number</span><input type="number" min={1} max={999} required {...f("lectureNo")} /></label>
        <label><span>Title</span><input type="text" maxLength={200} required {...f("title")} /></label>
        <label><span>YouTube link or video id</span><input type="text" required placeholder="https://youtu.be/…" {...f("video")} /></label>
        <label><span>Duration</span><input type="text" required placeholder="52:30" {...f("duration")} /></label>
        <label><span>Delivered on</span><input type="date" {...f("deliveredOn")} /></label>
      </div>
      <label><span>Description (optional)</span><textarea maxLength={1000} rows={2} {...f("description")} /></label>
      <div className="row">
        <button className="btn btn-primary" type="submit">{editing === "new" ? "Add lecture" : "Save changes"}</button>
        <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </form>
  );

  return (
    <div className="stack">
      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload(file);
        }}
      />
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-error"}`}>{msg.text}</div>}
      {editing !== null ? (
        editor
      ) : (
        <div>
          <button className="btn btn-primary" type="button" onClick={() => { setForm(emptyForm(nextNo)); setEditing("new"); setMsg(null); }}>
            + Add lecture
          </button>
        </div>
      )}

      <div className="card table-wrap" style={{ padding: "6px 12px" }}>
        {lectures === null ? (
          <p className="muted">Loading…</p>
        ) : lectures.length === 0 ? (
          <p className="muted">No lectures yet. Add the first one above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Lecture</th>
                <th>Length</th>
                <th>Transcript</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lectures.map((l) => {
                const chunks = Number(l.chunk_count);
                const embedded = Number(l.embedded_chunks);
                return (
                  <tr key={l.lecture_id}>
                    <td>{l.lecture_no}</td>
                    <td>
                      {l.transcript_status ? <Link href={`/lectures/${l.lecture_id}`}>{l.title}</Link> : l.title}
                      <div className="muted small mono">{l.youtube_video_id.trim()}</div>
                    </td>
                    <td>{mmss(l.duration_sec)}</td>
                    <td>
                      {busy[l.lecture_id] ? (
                        <span className="badge badge-muted">{busy[l.lecture_id]}</span>
                      ) : l.transcript_status === "indexed" ? (
                        <span className="badge badge-ok">Searchable · {chunks} passages</span>
                      ) : l.transcript_status === "chunked" ? (
                        <span className="badge badge-warn">Not embedded ({embedded}/{chunks})</span>
                      ) : (
                        <span className="badge badge-muted">No transcript</span>
                      )}
                      {l.uploaded_by_name && (
                        <div className="muted small">by {l.uploaded_by_name} (approves access requests)</div>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        {canUpload && (
                          <button className="btn btn-sm" type="button" disabled={!!busy[l.lecture_id]}
                            onClick={() => { uploadFor.current = l.lecture_id; fileInput.current?.click(); }}>
                            {l.transcript_status ? "Replace transcript" : "Upload .srt/.vtt"}
                          </button>
                        )}
                        {l.transcript_status === "chunked" && (
                          <button className="btn btn-sm" type="button" disabled={!!busy[l.lecture_id]} onClick={() => reembed(l)}>Re-embed</button>
                        )}
                        {l.transcript_status && (
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => deleteTranscript(l)}>Remove transcript</button>
                        )}
                        <button className="btn btn-sm" type="button" onClick={() => { setForm(toForm(l)); setEditing(l.lecture_id); setMsg(null); }}>Edit</button>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => deleteLecture(l)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
