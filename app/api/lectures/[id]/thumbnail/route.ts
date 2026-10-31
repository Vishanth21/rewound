// GET /api/lectures/:id/thumbnail
// Server-side thumbnail proxy. Only this server learns the YouTube id; the browser receives
// image bytes only, so a LOCKED search result can show a thumbnail without revealing the
// video link (design plan section 4).
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { parseId } from "@/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#e5e7eb"/><circle cx="160" cy="90" r="30" fill="#9ca3af"/><path d="M151 74l26 16-26 16z" fill="#f9fafb"/></svg>`;
const placeholder = () => new Response(PLACEHOLDER, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=300" } });

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi();
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return placeholder();
  try {
    const videoId = await withUser(session.user.id, async (c) => {
      const r = await c.query("SELECT get_thumbnail_source($1) AS id", [id]);
      return (r.rows[0]?.id as string | null)?.trim() ?? null;
    });
    if (!videoId) return placeholder();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, { signal: ctrl.signal });
      if (!res.ok) return placeholder();
      return new Response(await res.arrayBuffer(), {
        headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return placeholder();
  }
}
