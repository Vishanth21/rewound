// POST   /api/lectures/:id/transcript   upload .srt/.vtt -> chunk (DB procedure) -> embed (app) -> store vectors
// DELETE /api/lectures/:id/transcript   remove the transcript, its chunks and vectors
//
// Ingestion is two phases on purpose (design plan section 9): the chunking rules live in the
// ingest_transcript() procedure and commit atomically with the transcript row; only the
// embedding runs in Node, because the model runs here. If embedding fails the transcript is
// left as 'chunked' and can be retried with "Re-embed".
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { canManageLecture, parseId } from "@/lib/manage";
import { parseTranscript, TranscriptParseError } from "@/lib/transcript-parse";
import { storeEmbeddings } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid lecture id.");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("Choose a .srt or .vtt file to upload.");
  if (!/\.(srt|vtt)$/i.test(file.name)) return badRequest("Only .srt and .vtt caption files are supported.");
  if (file.size > MAX_BYTES) return badRequest("That file is larger than 5 MB.");

  let parsed;
  const raw = await file.text();
  try {
    parsed = parseTranscript(raw);
  } catch (e) {
    if (e instanceof TranscriptParseError) return Response.json({ error: e.message }, { status: 422 });
    throw e;
  }

  try {
    // Phase 1: chunk + store (one transaction, all or nothing)
    const chunks = await withUser(session.user.id, async (c) => {
      if (!(await canManageLecture(c, session, id))) throw Object.assign(new Error("You do not teach this course."), { code: "42501" });
      await c.query("CALL ingest_transcript($1, $2, $3, $4::jsonb)", [id, parsed.format, raw, JSON.stringify(parsed.segments)]);
      const { rows } = await c.query("SELECT seq_no, content FROM get_lecture($1) ORDER BY seq_no", [id]);
      return rows as { seq_no: number; content: string }[];
    });

    // Phase 2: embed + store vectors
    try {
      await storeEmbeddings(session.user.id, id, chunks);
    } catch (e) {
      console.error("[embedding failed]", e);
      return Response.json({
        status: "chunked", chunks: chunks.length, cues: parsed.segments.length,
        warning: "The transcript was saved but embedding failed, so it is not searchable yet. Use Re-embed to retry.",
      });
    }
    return Response.json({ status: "indexed", chunks: chunks.length, cues: parsed.segments.length });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const id = parseId(params.id);
  if (!id) return badRequest("Invalid lecture id.");
  try {
    await withUser(session.user.id, (c) => c.query("CALL delete_transcript($1)", [id]));
    return Response.json({ ok: true });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

