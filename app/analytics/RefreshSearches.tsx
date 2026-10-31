"use client";
// The materialised view can only be refreshed by its owner, so the app calls the
// SECURITY DEFINER wrapper refresh_daily_searches() through /api/analytics.
// Refresh is manual: on this dataset it is instant, and a scheduler would be more moving
// parts than the demo needs.
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RefreshSearches() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/analytics", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: body.error ?? "Could not refresh the search trend." });
      return;
    }
    setMsg({ ok: true, text: "Search trend refreshed." });
    router.refresh();
  }

  return (
    <div className="row" style={{ alignItems: "center" }}>
      {msg && (
        <span className="small" style={{ color: msg.ok ? "var(--ok)" : "var(--danger)" }}>
          {msg.text}
        </span>
      )}
      <button className="btn btn-sm" type="button" onClick={refresh} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh search trend"}
      </button>
    </div>
  );
}