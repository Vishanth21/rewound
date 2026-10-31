"use client";
// STAND-IN for Member B's request-access modal (design plan section 18: "button sits on A's
// locked card"). It posts { lectureId, reason } to B's /api/requests, which calls
// request_access(). B can replace this component without touching SearchClient.
import { useState } from "react";

export default function RequestAccess({ lectureId, title }: { lectureId: number; title: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; msg?: string }>({ kind: "idle" });

  if (state.kind === "done") return <div className="alert alert-ok">Request sent. Track it under My requests.</div>;
  if (!open) {
    return (
      <div>
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setOpen(true)}>
          Request access
        </button>
      </div>
    );
  }

  async function send() {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lectureId, reason }),
      });
      if (res.status === 404) throw new Error("Access requests are not available yet.");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the request.");
      setState({ kind: "done" });
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label>
        <span>Why do you need “{title}”?</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. I am revising this topic for my project." />
      </label>
      {state.kind === "error" && <div className="alert alert-error">{state.msg}</div>}
      <div className="row">
        <button className="btn btn-primary btn-sm" type="button" disabled={!reason.trim() || state.kind === "sending"} onClick={send}>
          {state.kind === "sending" ? "Sending…" : "Send request"}
        </button>
        <button className="btn btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
        <span className="muted small">{reason.length}/500</span>
      </div>
    </div>
  );
}
