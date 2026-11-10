import { withUser } from "@/lib/db";
import { storeEmbeddings } from "@/lib/ingest";
import { canManageLecture } from "@/lib/manage";
import type { Session } from "@/lib/auth";
import type { ParsedTranscript } from "@/lib/transcript-parse";
import type { TranscriptProgress } from "@/lib/transcript-progress";

export async function ingestTranscript(
  session: Session,
  lectureId: number,
  parsed: ParsedTranscript,
  raw: string,
  report: (progress: TranscriptProgress) => void,
) {
  report({ stage: "chunking", message: `Chunking ${parsed.segments.length} captions into searchable passages…`, cues: parsed.segments.length });

  const chunks = await withUser(session.user.id, async (c) => {
    if (!(await canManageLecture(c, session, lectureId))) {
      throw Object.assign(new Error("You do not teach this course."), { code: "42501" });
    }
    await c.query("CALL ingest_transcript($1, $2, $3, $4::jsonb)", [
      lectureId, parsed.format, raw, JSON.stringify(parsed.segments),
    ]);
    const { rows } = await c.query("SELECT seq_no, content FROM get_lecture($1) ORDER BY seq_no", [lectureId]);
    return rows as { seq_no: number; content: string }[];
  });

  report({ stage: "embedding", message: `Embedding ${chunks.length} passages for search…`, cues: parsed.segments.length, chunks: chunks.length });
  try {
    let lastReportedProgress = -5;
    await storeEmbeddings(session.user.id, lectureId, chunks, (progress) => {
      if (progress.status === "progress_total" && typeof progress.progress === "number") {
        const percent = Math.floor(progress.progress);
        if (percent < 100 && percent - lastReportedProgress < 5) return;
        lastReportedProgress = percent;
        const loaded = typeof progress.loaded === "number" ? ` (${formatMb(progress.loaded)} / ${formatMb(progress.total)})` : "";
        report({ stage: "model", message: `Downloading embedding model: ${percent}%${loaded}`, cues: parsed.segments.length, chunks: chunks.length });
      } else if (progress.status === "retry") {
        report({ stage: "model", message: `Model download failed temporarily; retrying in ${progress.file}…`, cues: parsed.segments.length, chunks: chunks.length });
      } else if (progress.status === "initiate" || progress.status === "download") {
        report({ stage: "model", message: `Loading embedding model${progress.file ? ` (${progress.file})` : ""}…`, cues: parsed.segments.length, chunks: chunks.length });
      } else if (progress.status === "ready") {
        report({ stage: "embedding", message: `Model ready; embedding ${chunks.length} passages…`, cues: parsed.segments.length, chunks: chunks.length });
      }
    });
    return { status: "indexed" as const, cues: parsed.segments.length, chunks: chunks.length };
  } catch (error) {
    console.error("[embedding failed]", error);
    const detail = error instanceof Error ? `: ${error.message}` : "";
    return {
      status: "chunked" as const,
      cues: parsed.segments.length,
      chunks: chunks.length,
      warning: `Captions were saved and chunked, but model loading or embedding failed${detail}. Use Re-embed to retry.`,
    };
  }
}

function formatMb(bytes: number | undefined): string {
  return typeof bytes === "number" ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "unknown size";
}
