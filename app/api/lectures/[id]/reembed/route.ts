// POST /api/lectures/:id/reembed
// Vector UPDATE: recompute every chunk's embedding from its current text (for example after
// editing passages or switching the embedding model).
import { withUser } from "@/lib/db";
import { storeEmbeddings } from "@/lib/ingest";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { canManageLecture, parseId } from "@/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid lecture id.");
  try {
    const chunks = await withUser(session.user.id, async (c) => {
      if (!(await canManageLecture(c, session, id))) throw Object.assign(new Error("You do not teach this course."), { code: "42501" });
      return (await c.query("SELECT seq_no, content FROM get_lecture($1) ORDER BY seq_no", [id])).rows as { seq_no: number; content: string }[];
    });
    if (chunks.length === 0) return Response.json({ error: "This lecture has no transcript to embed." }, { status: 404 });
    await storeEmbeddings(session.user.id, id, chunks);
    return Response.json({ status: "indexed", chunks: chunks.length });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
