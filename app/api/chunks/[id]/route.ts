// PATCH /api/chunks/:id   { text }
// Vector UPDATE: fix a mis-transcribed passage. update_chunk_text() clears the stale vector;
// we embed the corrected text and store it, which makes the transcript indexed again.
import { z } from "zod";
import { withUser } from "@/lib/db";
import { storeEmbeddings } from "@/lib/ingest";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { parseId } from "@/lib/manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(1, "The passage cannot be blank.").max(4000) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid passage id.");
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0].message);

  try {
    const { lectureId, seqNo } = await withUser(session.user.id, async (c) => {
      const r = await c.query("SELECT lecture_id, seq_no FROM update_chunk_text($1, $2)", [id, body.data.text]);
      return { lectureId: r.rows[0].lecture_id as number, seqNo: r.rows[0].seq_no as number };
    });
    try {
      await storeEmbeddings(session.user.id, lectureId, [{ seq_no: seqNo, content: body.data.text }]);
    } catch (e) {
      console.error("[embedding failed]", e);
      return Response.json({ status: "chunked", warning: "Saved, but re-embedding failed. Use Re-embed on the lecture." });
    }
    return Response.json({ status: "indexed" });
  } catch (e) {
    return dbErrorResponse(e);
  }
}
