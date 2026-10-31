"use client";
// Search box + results (Member A). In-scope lectures show up to 3 passages with "▶ mm:ss" links.
// Locked lectures (nothing in scope matched) show only a proxied thumbnail, course and excerpt.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/lib/auth";
import { matchPercent, mmss, splitHighlights } from "@/lib/format";
import RequestAccess from "./RequestAccess";

type Mode = "semantic" | "keyword";
type Passage = { chunkId: number | null; startSec: number | null; text: string; distance: number | null };
type Result = { lectureId: number; courseCode: string; lectureNo: number; title: string; locked: boolean; score: number; passages: Passage[] };

const EXAMPLES = ["how do we stop two transactions overwriting each other", "why does a model do well on training data but badly on new data", "deadlock prevention"];

export default function SearchClient({ role, courses, initial }: {
  role: Role;
  courses: string[];
  initial: { q: string; mode: Mode; course: string };
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [course, setCourse] = useState(initial.course);
  const [results, setResults] = useState<Result[] | null>(null);
  const [searched, setSearched] = useState<{ q: string; mode: Mode } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (query: string, m: Mode, c: string) => {
      const text = query.trim();
      if (text.length < 2) {
        setError("Type at least 2 characters.");
        return;
      }
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ q: text, mode: m, ...(c ? { course: c } : {}) });
      router.replace(`/search?${params}`, { scroll: false });
      try {
        const res = await fetch(`/api/search?${params}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Search failed.");
        setResults(body.results);
        setSearched({ q: text, mode: m });
      } catch (e) {
        setError((e as Error).message);
        setResults(null);
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (initial.q) run(initial.q, initial.mode, initial.course);
    // run once for a shared/bookmarked URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inScope = results?.filter((r) => !r.locked) ?? [];
  const locked = results?.filter((r) => r.locked) ?? [];

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(q, mode, course);
        }}
      >
        <div className="search-box">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "semantic" ? "e.g. where is deadlock prevention explained?" : "e.g. BCNF, two-phase locking"}
            maxLength={300}
            aria-label="Search query"
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Search mode">
            <button type="button" aria-pressed={mode === "semantic"} onClick={() => setMode("semantic")}>
              By meaning
            </button>
            <button type="button" aria-pressed={mode === "keyword"} onClick={() => setMode("keyword")}>
              Exact words
            </button>
          </div>
          {courses.length > 1 && (
            <select value={course} onChange={(e) => setCourse(e.target.value)} style={{ width: "auto" }} aria-label="Course filter">
              <option value="">All my courses</option>
              {courses.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <span className="muted small">
            {mode === "semantic" ? "Finds explanations even when the wording differs." : "Full-text match: best for codes, acronyms and names."}
          </span>
        </div>
      </form>

      {error && <div className="alert alert-error">{error}</div>}

      {!results && !error && !loading && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Try one of these:</p>
          <div className="row">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="btn btn-sm" type="button" onClick={() => { setQ(ex); setMode("semantic"); run(ex, "semantic", course); }}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {results && searched && results.length === 0 && (
        <div className="card">
          <h3>No lectures matched “{searched.q}”.</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            {searched.mode === "semantic"
              ? "Try rephrasing the question, or switch to Exact words for a specific term."
              : "No transcript contains those words. Try By meaning to search by idea instead."}
          </p>
        </div>
      )}

      {inScope.length > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          {inScope.length} lecture{inScope.length === 1 ? "" : "s"} matched
        </p>
      )}
      {inScope.map((r) => (
        <article key={r.lectureId} className="card">
          <div className="result-head">
            <h3>
              <span className="course-code">{r.courseCode}</span>
              <Link href={`/lectures/${r.lectureId}`}>
                Lecture {r.lectureNo} · {r.title}
              </Link>
            </h3>
            {searched?.mode === "semantic" && <span className="badge badge-ok">{matchPercent(r.score)}% match</span>}
          </div>
          <ul className="passages">
            {r.passages.map((p, i) => (
              <li key={p.chunkId ?? i} className="passage">
                {p.startSec !== null && (
                  <Link className="ts" href={`/lectures/${r.lectureId}?t=${Math.floor(p.startSec)}`} title="Play from here">
                    ▶ {mmss(p.startSec)}
                  </Link>
                )}
                <p className="clamp">
                  {splitHighlights(p.text).map((part, j) => (part.hit ? <mark key={j}>{part.text}</mark> : <span key={j}>{part.text}</span>))}
                </p>
              </li>
            ))}
          </ul>
        </article>
      ))}

      {locked.length > 0 && (
        <>
          <div className="card locked-note">
            <h3>Nothing in your courses matches “{searched?.q}”.</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              {locked.length === 1 ? "This lecture" : "These lectures"} outside your access cover it.
              {role === "student" ? " You can ask the instructor for access to one lecture at a time." : ""}
            </p>
          </div>
          {locked.map((r) => (
            <article key={r.lectureId} className="card locked-card">
              <div className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/lectures/${r.lectureId}/thumbnail`} alt="" loading="lazy" />
                <span className="lock" aria-hidden>🔒</span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div className="result-head">
                  <h3>
                    <span className="course-code">{r.courseCode}</span>
                    Lecture {r.lectureNo} · {r.title}
                  </h3>
                  <span className="badge badge-lock">Locked</span>
                </div>
                <p className="clamp muted">{r.passages[0]?.text}</p>
                {role === "student" && <RequestAccess lectureId={r.lectureId} title={r.title} />}
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
