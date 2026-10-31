"use client";
import { useEffect, useRef, useState } from "react";

export default function RequestAccess({ lectureId, title }: { lectureId: number; title: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; msg?: string }>({ kind: "idle" });
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  if (state.kind === "done") return <div className="alert alert-ok" role="status">Request sent. Track it under My requests.</div>;

  async function send() {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lectureId, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the request.");
      dialog.current?.close();
      setOpen(false);
      setState({ kind: "done" });
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <>
      <button className="btn btn-primary btn-sm" type="button" onClick={() => setOpen(true)}>
        Request access
      </button>
      <dialog
        ref={dialog}
        className="request-dialog"
        aria-labelledby={`request-title-${lectureId}`}
        onClose={() => setOpen(false)}
      >
        <div className="stack" style={{ gap: 12 }}>
          <div>
            <h2 id={`request-title-${lectureId}`}>Request lecture access</h2>
            <p className="muted small" style={{ margin: 0 }}>{title}</p>
          </div>
          <label>
            <span>Why do you need access?</span>
            <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. I am revising this topic for my project." />
          </label>
          {state.kind === "error" && <div className="alert alert-error" role="alert">{state.msg}</div>}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">{reason.length}/500</span>
            <div className="row">
              <button className="btn btn-sm" type="button" disabled={state.kind === "sending"} onClick={() => dialog.current?.close()}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" type="button" disabled={!reason.trim() || state.kind === "sending"} onClick={send}>
                {state.kind === "sending" ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
