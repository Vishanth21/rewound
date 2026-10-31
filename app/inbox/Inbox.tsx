"use client";
// The decision queue. Every action is a POST to /api/requests/:id/decision; the route calls
// decide_request(), which takes FOR UPDATE on the row, so two approvers clicking at once
// cannot both win -- the second gets "was already approved" back as a 422.
import { useRouter } from "next/navigation";
import { useState } from "react";

type Req = {
  requestId: number;
  studentName: string;
  courseCode: string;
  lectureNo: number;
  lectureTitle: string;
  reason: string;
  requestedAt: string;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Inbox({ requests }: { requests: Req[] }) {
  const router = useRouter();
  // Per-row UI state, so a slow decision does not block the rest of the queue.
  const [busy, setBusy] = useState<Set<number>>(() => new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [days, setDays] = useState<Record<number, string>>({});

  async function decide(r: Req, approve: boolean) {
    const d = Number(days[r.requestId] ?? "7");
    if (approve && (!Number.isInteger(d) || d < 1 || d > 90)) {
      setMsg({ ok: false, text: "Grant must be between 1 and 90 days." });
      return;
    }
    setBusy((current) => new Set(current).add(r.requestId));
    setMsg(null);
    try {
      const res = await fetch(`/api/requests/${r.requestId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, days: d }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: body.error ?? "Could not record the decision." });
        // A 404/422 usually means someone else already decided it: refresh so the row leaves.
        if (res.status === 404 || res.status === 422) router.refresh();
        return;
      }
      setMsg({
        ok: true,
        text: approve ? `Approved ${r.studentName} for ${d} day${d === 1 ? "" : "s"}.` : `Declined ${r.studentName}.`,
      });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(r.requestId);
        return next;
      });
    }
  }

  if (requests.length === 0) {
    return <div className="card muted">Nothing waiting. Requests appear here as students ask for your lectures.</div>;
  }

  return (
    <div className="stack">
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-error"}`}>{msg.text}</div>}
      {requests.map((r) => (
        <div key={r.requestId} className="card">
          <div className="result-head">
            <div>
              <div>
                <strong>{r.studentName}</strong> <span className="muted small">asked for</span>
              </div>
              <div>
                <span className="course-code">{r.courseCode}</span>{" "}
                <span className="muted small">Lecture {r.lectureNo}</span> — {r.lectureTitle}
              </div>
            </div>
            <span className="muted small">{fmt(r.requestedAt)}</span>
          </div>

          <p className="small" style={{ margin: "10px 0" }}>
            <span className="muted">Reason: </span>
            {r.reason}
          </p>

          <div className="row">
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <span className="small muted">for</span>
              <input
                type="number"
                min={1}
                max={90}
                value={days[r.requestId] ?? "7"}
                onChange={(e) => setDays((s) => ({ ...s, [r.requestId]: e.target.value }))}
                style={{ width: 72 }}
                disabled={busy.has(r.requestId)}
              />
              <span className="small muted">days</span>
            </label>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy.has(r.requestId)} onClick={() => decide(r, true)}>
              {busy.has(r.requestId) ? "Working…" : "Approve"}
            </button>
            <button className="btn btn-sm" type="button" disabled={busy.has(r.requestId)} onClick={() => decide(r, false)}>
              {busy.has(r.requestId) ? "Working…" : "Decline"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
