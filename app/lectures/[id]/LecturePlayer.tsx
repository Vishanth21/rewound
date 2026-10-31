"use client";
// YouTube IFrame player + scrolling transcript (Member A). Clicking a passage calls
// player.seekTo(start_sec); while the video plays, the passage being spoken is highlighted.
// Instructors of the course (and admins) can correct a passage: the API clears its old vector
// and re-embeds the new text (vector UPDATE).
import { useEffect, useRef, useState } from "react";
import { mmss } from "@/lib/format";

type Chunk = { chunkId: number; seqNo: number; startSec: number; endSec: number; text: string };
type YTPlayer = { seekTo(s: number, allowSeekAhead: boolean): void; playVideo(): void; getCurrentTime(): number; getPlayerState(): number; destroy(): void };
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: object) => YTPlayer; PlayerState: { PLAYING: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.getElementById("yt-iframe-api")) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  });
}

/** Chunks overlap by one cue, so the "current" one is the last that has started. */
function activeIndex(chunks: Chunk[], t: number): number {
  let idx = -1;
  for (let i = 0; i < chunks.length; i++) if (chunks[i].startSec <= t + 0.25) idx = i;
  return idx;
}

export default function LecturePlayer({ videoId, start, chunks: initialChunks, canEdit }: {
  videoId: string;
  start: number;
  chunks: Chunk[];
  canEdit: boolean;
}) {
  const [chunks, setChunks] = useState(initialChunks);
  const [current, setCurrent] = useState(() => activeIndex(initialChunks, start));
  const [videoError, setVideoError] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !holder.current || !window.YT) return;
      const el = document.createElement("div");
      holder.current.appendChild(el);
      player.current = new window.YT.Player(el, {
        videoId,
        playerVars: { start, rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onError: () => setVideoError(true) },
      });
    });
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId, start]);

  // Follow playback.
  useEffect(() => {
    const timer = setInterval(() => {
      const p = player.current;
      if (!p?.getCurrentTime || !window.YT || p.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
      setCurrent(activeIndex(chunks, p.getCurrentTime()));
    }, 500);
    return () => clearInterval(timer);
  }, [chunks]);

  // Keep the active passage visible, unless the user is reading elsewhere in the list.
  useEffect(() => {
    if (current < 0 || !following.current) return;
    list.current?.querySelector(`[data-idx="${current}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  function seek(c: Chunk, i: number) {
    following.current = true;
    setCurrent(i);
    const p = player.current;
    if (p?.seekTo) {
      p.seekTo(c.startSec, true);
      p.playVideo();
    }
    const url = new URL(window.location.href);
    url.searchParams.set("t", String(Math.floor(c.startSec)));
    window.history.replaceState(null, "", url);
  }

  async function save(c: Chunk) {
    setSaveMsg(null);
    const res = await fetch(`/api/chunks/${c.chunkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: draft }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaveMsg({ ok: false, text: body.error ?? "Could not save." });
      return;
    }
    setChunks((cs) => cs.map((x) => (x.chunkId === c.chunkId ? { ...x, text: draft.trim() } : x)));
    setEditing(null);
    setSaveMsg({ ok: !body.warning, text: body.warning ?? "Saved and re-embedded. Search now uses the corrected text." });
  }

  return (
    <div className="player-layout">
      <div className="stack">
        <div className="video" ref={holder} />
        {videoError && (
          <div className="alert alert-error">
            The video could not be loaded. Its YouTube id may be wrong or the video may be private. The transcript below still works.
          </div>
        )}
        {saveMsg && <div className={`alert ${saveMsg.ok ? "alert-ok" : "alert-error"}`}>{saveMsg.text}</div>}
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ margin: 0 }}>Transcript</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {chunks.length} passages · click one to jump to it
          </p>
        </div>
        <div
          className="transcript"
          ref={list}
          onWheel={() => (following.current = false)}
          onTouchMove={() => (following.current = false)}
        >
          {chunks.map((c, i) =>
            editing === c.chunkId ? (
              <div key={c.chunkId} className="chunk active" data-idx={i}>
                <span className="ts">{mmss(c.startSec)}</span>
                <div className="chunk-edit">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} maxLength={4000} />
                  <div className="row">
                    <button className="btn btn-primary btn-sm" type="button" disabled={!draft.trim()} onClick={() => save(c)}>Save &amp; re-embed</button>
                    <button className="btn btn-sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={c.chunkId}
                data-idx={i}
                className={`chunk${i === current ? " active" : ""}`}
                onClick={() => seek(c, i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), seek(c, i))}
              >
                <span className="ts">{mmss(c.startSec)}</span>
                <div style={{ flex: 1 }}>
                  <p>{c.text}</p>
                  {canEdit && (
                    <button
                      className="link-btn small muted"
                      style={{ color: "var(--muted)", marginTop: 4 }}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft(c.text);
                        setEditing(c.chunkId);
                      }}
                    >
                      Edit passage
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
