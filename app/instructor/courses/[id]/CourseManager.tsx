"use client";
// Lecture list with transcript status, add/edit/delete lectures, upload .srt/.vtt (Member A).
// Upload = chunk in the database (ingest_transcript) + embed in Node (set_chunk_embeddings).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { mmss, parseDuration } from "@/lib/format";
import { parseYouTubeId } from "@/lib/youtube";

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

async function callWithProgress(
  url: string,
  init: RequestInit,
  onProgress: (message: string) => void,
): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(url, init);
  if (!res.ok || !res.headers.get("content-type")?.includes("application/x-ndjson") || !res.body) {
    const body = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
    return { ok: false, body };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last: Record<string, unknown> = {};
  let failed = false;

  function receive(line: string) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      last = event;
      if (event.stage === "error") failed = true;
      if (typeof event.message === "string") onProgress(event.message);
    } catch {
      // Ignore malformed progress lines and keep reading the stream.
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(receive);
    if (done) break;
  }
  receive(buffer);
  return { ok: !failed && last.stage === "done", body: last };
}

export default function CourseManager({ courseId, canUpload }: { courseId: number; canUpload: boolean }) {
  const [lectures, setLectures] = useState<Lecture[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm(1));
  const [busy, setBusy] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [captionSource, setCaptionSource] = useState<"none" | "upload" | "youtube">("none");
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [playlistImportOpen, setPlaylistImportOpen] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [importingPlaylist, setImportingPlaylist] = useState(false);
  const [youtubeLookup, setYoutubeLookup] = useState<{ kind: "idle" | "loading" | "done" | "error"; text?: string }>({ kind: "idle" });
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

  useEffect(() => {
    if (editing !== "new") return;
    const videoId = parseYouTubeId(form.video);
    if (!videoId) {
      setYoutubeLookup({ kind: "idle" });
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setYoutubeLookup({ kind: "loading" });
      const result = await call(`/api/youtube/video?video=${encodeURIComponent(videoId)}`);
      if (cancelled) return;
      if (!result.ok) {
        setYoutubeLookup({ kind: "error", text: String(result.body.error ?? "Could not fetch YouTube details.") });
        return;
      }
      setForm((current) => ({
        ...current,
        title: String(result.body.title),
        description: String(result.body.description),
        duration: mmss(Number(result.body.durationSec)),
        deliveredOn: String(result.body.publishedAt),
      }));
      setYoutubeLookup({
        kind: "done",
        text: result.body.descriptionTruncated
          ? "YouTube details filled in. Description was shortened to fit the 1,000-character limit."
          : "YouTube details filled in. You can edit any field before saving.",
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editing, form.video]);

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
    const isNew = editing === "new";
    if (isNew && captionSource === "upload" && !subtitleFile) {
      setMsg({ ok: false, text: "Choose an .srt or .vtt subtitle file, or select another caption option." });
      return;
    }
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
    const selectedCaptionSource = captionSource;
    const selectedSubtitleFile = subtitleFile;
    setSaving(true);
    setMsg(null);
    try {
      const r = isNew
        ? await call(`/api/courses/${courseId}/lectures`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await call(`/api/lectures/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) {
        setMsg({ ok: false, text: String(r.body.error) });
        return;
      }

      setEditing(null);
      if (!isNew) {
        setMsg({ ok: true, text: "Lecture updated." });
        load();
        return;
      }

      setCaptionSource("none");
      setSubtitleFile(null);
      const newLectureId = Number(r.body.lectureId);
      await load();
      if (!newLectureId) {
        setMsg({ ok: true, text: "Lecture added." });
      } else if (selectedCaptionSource === "upload" && selectedSubtitleFile) {
        setMsg({ ok: true, text: "Lecture added. Processing its subtitle file…" });
        await ingestFile(newLectureId, selectedSubtitleFile);
      } else if (selectedCaptionSource === "youtube") {
        setMsg({ ok: true, text: "Lecture added. Fetching its YouTube captions…" });
        await fetchCaptionsFor(newLectureId);
      } else {
        setMsg({ ok: true, text: "Lecture added. You can add captions from its row below." });
      }
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Could not save the lecture." });
    } finally {
      setSaving(false);
    }
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
    await ingestFile(id, file);
  }

  async function ingestFile(id: number, file: File) {
    setBusyFor(id, "Uploading captions…");
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await callWithProgress(`/api/lectures/${id}/transcript`, { method: "POST", body: fd }, (message) => setBusyFor(id, message));
      if (!r.ok || r.body.status === "chunked") setMsg({ ok: false, text: String(r.body.error ?? r.body.warning ?? r.body.message) });
      else setMsg({ ok: true, text: String(r.body.message) });
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Could not process the subtitle file." });
    } finally {
      setBusyFor(id, null);
      load();
    }
  }

  async function fetchCaptionsFor(id: number) {
    setBusyFor(id, "Starting caption fetch…");
    setMsg(null);
    try {
      const r = await callWithProgress(
        `/api/lectures/${id}/transcript/youtube`,
        { method: "POST" },
        (message) => setBusyFor(id, message),
      );
      if (!r.ok || r.body.status === "chunked") setMsg({ ok: false, text: String(r.body.error ?? r.body.warning ?? r.body.message) });
      else setMsg({ ok: true, text: String(r.body.message) });
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Could not fetch captions." });
    } finally {
      setBusyFor(id, null);
      load();
    }
  }

  async function fetchCaptions(l: Lecture) {
    await fetchCaptionsFor(l.lecture_id);
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

  async function importPlaylist(e: React.FormEvent) {
    e.preventDefault();
    setImportingPlaylist(true);
    setMsg(null);
    try {
      const r = await call(`/api/courses/${courseId}/playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlist: playlistUrl }),
      });
      if (!r.ok) {
        setMsg({ ok: false, text: String(r.body.error ?? "Could not import the playlist.") });
        return;
      }
      const imported = Number(r.body.imported ?? 0);
      const skipped = ["alreadyInCourse", "unavailable", "unsupportedDuration", "numberLimit"]
        .reduce((total, key) => total + Number(r.body[key] ?? 0), 0);
      const skipDetails = [
        ["alreadyInCourse", "already in this course"],
        ["unavailable", "unavailable videos"],
        ["unsupportedDuration", "videos with unsupported duration"],
        ["numberLimit", "beyond the course lecture-number limit"],
      ]
        .map(([key, label]) => {
          const count = Number(r.body[key] ?? 0);
          return count ? `${count} ${label}` : null;
        })
        .filter(Boolean)
        .join(", ");
      setPlaylistImportOpen(false);
      setPlaylistUrl("");
      setMsg({
        ok: true,
        text: `Imported ${imported} lecture${imported === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} (${skipDetails})` : ""}. Captions were not fetched. Use Fetch captions on a lecture when you want to index it.`,
      });
      await load();
    } catch (error) {
      setMsg({ ok: false, text: error instanceof Error ? error.message : "Could not import the playlist." });
    } finally {
      setImportingPlaylist(false);
    }
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
        <label><span>Video published on</span><input type="date" {...f("deliveredOn")} /></label>
      </div>
      {youtubeLookup.kind !== "idle" && (
        <p className={`small ${youtubeLookup.kind === "error" ? "alert-error" : "muted"}`} style={{ margin: 0 }} role="status">
          {youtubeLookup.kind === "loading" ? "Fetching video details from YouTube…" : youtubeLookup.text}
        </p>
      )}
      <label><span>Description (optional)</span><textarea maxLength={1000} rows={2} {...f("description")} /></label>
      {editing === "new" && canUpload && (
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
          <legend className="small muted" style={{ padding: "0 4px" }}>Captions (optional)</legend>
          <label>
            <span>Subtitle source</span>
            <select value={captionSource} onChange={(e) => setCaptionSource(e.target.value as "none" | "upload" | "youtube")}>
              <option value="none">Add captions later</option>
              <option value="upload">Upload an .srt or .vtt file</option>
              <option value="youtube">Fetch English captions from YouTube</option>
            </select>
          </label>
          {captionSource === "upload" && (
            <label style={{ marginTop: 8 }}>
              <span>Subtitle file</span>
              <input type="file" accept=".srt,.vtt" required
                onChange={(e) => setSubtitleFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <p className="muted small" style={{ margin: "8px 0 0" }}>
            The lecture is created first. Caption fetching, chunking, and indexing then run with live status in the lecture list.
          </p>
        </fieldset>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editing === "new" ? "Add lecture" : "Save changes"}</button>
        <button className="btn" type="button" disabled={saving} onClick={() => { setEditing(null); setCaptionSource("none"); setSubtitleFile(null); }}>Cancel</button>
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
        <div className="row">
          <button className="btn btn-primary" type="button" disabled={importingPlaylist} onClick={() => { setPlaylistImportOpen(false); setForm(emptyForm(nextNo)); setCaptionSource("none"); setSubtitleFile(null); setEditing("new"); setMsg(null); }}>
            + Add lecture
          </button>
          <button className="btn" type="button" disabled={importingPlaylist} onClick={() => { setPlaylistImportOpen((open) => !open); setMsg(null); }}>
            Import playlist
          </button>
        </div>
      )}

      {playlistImportOpen && editing === null && (
        <form className="card stack" onSubmit={importPlaylist}>
          <h2 style={{ margin: 0 }}>Import a YouTube playlist</h2>
          <label>
            <span>Playlist URL or ID</span>
            <input type="text" required maxLength={500} value={playlistUrl} onChange={(e) => setPlaylistUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" disabled={importingPlaylist} />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            Videos are added in playlist order with their YouTube details. Captions are fetched only when you choose Fetch captions for a lecture.
          </p>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={importingPlaylist}>{importingPlaylist ? "Importing playlist…" : "Import videos"}</button>
            <button className="btn" type="button" disabled={importingPlaylist} onClick={() => setPlaylistImportOpen(false)}>Cancel</button>
          </div>
        </form>
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
                          <>
                            <button className="btn btn-sm" type="button" disabled={!!busy[l.lecture_id]}
                              onClick={() => { uploadFor.current = l.lecture_id; fileInput.current?.click(); }}>
                              {l.transcript_status ? "Replace transcript" : "Upload .srt/.vtt"}
                            </button>
                            <button className="btn btn-sm" type="button" disabled={!!busy[l.lecture_id]} onClick={() => fetchCaptions(l)}>
                              {l.transcript_status ? "Replace from YouTube" : "Fetch captions"}
                            </button>
                          </>
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
