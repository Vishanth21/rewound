// POST   /api/lectures/:id/transcript   upload .srt/.vtt -> chunk (DB procedure) -> embed (app) -> store vectors
// DELETE /api/lectures/:id/transcript   remove the transcript, its chunks and vectors
//
// Ingestion is two phases on purpose (design plan section 9): the chunking rules live in the
// ingest_transcript() procedure and commit atomically with the transcript row; only the
// embedding runs in Node, because the model runs here. If embedding fails the transcript is
// left as 'chunked' and can be retried with "Re-embed".
import { requireApi, isResponse } from "@/lib/guard";
import { withUser } from "@/lib/db";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { parseId } from "@/lib/manage";
import { parseTranscript, TranscriptParseError } from "@/lib/transcript-parse";
import { ingestTranscript } from "@/lib/transcript-ingest";
import { transcriptProgressResponse } from "@/lib/transcript-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApi(["instructor"]);
  if (isResponse(session)) return session;
  const { id: rawId } = await params;
  const id = parseId(rawId);
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

  return transcriptProgressResponse(async (report) => {
    try {
      const result = await ingestTranscript(session, id, parsed, raw, report);
      const message = result.status === "indexed"
        ? `Transcript indexed: ${result.cues} captions packed into ${result.chunks} searchable passages.`
        : result.warning ?? "Transcript was saved but could not be indexed.";
      report({ stage: "done", ...result, message });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = code
        ? ((await dbErrorResponse(error).json().catch(() => ({}))) as { error?: string }).error ?? "Transcript processing failed."
        : error instanceof Error ? error.message : "Transcript processing failed.";
      report({ stage: "error", error: message, message });
    }
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id) return badRequest("Invalid lecture id.");
  try {
    await withUser(session.user.id, (c) => c.query("CALL delete_transcript($1)", [id]));
    return Response.json({ ok: true });
  } catch (e) {
    return dbErrorResponse(e);
  }
}

