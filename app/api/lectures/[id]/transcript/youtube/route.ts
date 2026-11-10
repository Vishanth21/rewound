import { spawn } from "node:child_process";
import { join } from "node:path";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { canManageLecture, parseId } from "@/lib/manage";
import { parseTranscript, TranscriptParseError } from "@/lib/transcript-parse";
import { ingestTranscript } from "@/lib/transcript-ingest";
import { transcriptProgressResponse } from "@/lib/transcript-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type FetchedCaptions = {
  language: string;
  languageCode: string;
  isGenerated: boolean;
  snippets: { text: string; start: number; duration: number }[];
};

function fetchCaptions(videoId: string): Promise<FetchedCaptions> {
  return new Promise((resolve, reject) => {
    const python = process.env.TRANSCRIPT_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const script = join(process.cwd(), "scripts", "fetch_youtube_transcript.py");
    const child = spawn(python, [script, videoId], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let tooLarge = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 12_000_000 && !tooLarge) {
        tooLarge = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => {
      reject(error.code === "ENOENT"
        ? new Error("Python was not found. Install Python and youtube-transcript-api; see README.md.")
        : error);
    });
    child.on("close", (code) => {
      if (tooLarge) return reject(new Error("The caption response was unexpectedly large."));
      if (code !== 0) {
        const message = stderr.trim();
        return reject(new Error(message || "Could not fetch captions. This video may not have English captions or YouTube may have blocked the request."));
      }
      try {
        resolve(JSON.parse(stdout) as FetchedCaptions);
      } catch {
        reject(new Error("YouTube returned captions in an unexpected format."));
      }
    });
  });
}

function vttTime(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function toVtt(snippets: FetchedCaptions["snippets"]): string {
  const cues = snippets
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.duration) && cue.start >= 0 && cue.text.trim())
    .map((cue, i) => {
      const start = cue.start;
      const end = start + Math.max(cue.duration, 0.1);
      return `${i + 1}\n${vttTime(start)} --> ${vttTime(end)}\n${cue.text.replace(/\s+/g, " ").trim()}`;
    });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApi(["instructor"]);
  if (isResponse(session)) return session;
  const { id: rawId } = await params;
  const lectureId = parseId(rawId);
  if (!lectureId) return badRequest("Invalid lecture id.");

  const { access, videoId } = await withUser(session.user.id, async (c) => {
    const courseId = (await c.query("SELECT course_id FROM lecture WHERE lecture_id = $1", [lectureId])).rows[0]?.course_id;
    if (!courseId) return { access: false, videoId: "" };
    const allowed = await canManageLecture(c, session, lectureId);
    if (!allowed) return { access: false, videoId: "" };
    const row = (await c.query(
      "SELECT youtube_video_id FROM course_lectures($1) WHERE lecture_id = $2",
      [courseId, lectureId],
    )).rows[0];
    return { access: true, videoId: String(row?.youtube_video_id ?? "").trim() };
  });
  if (!access) return Response.json({ error: "You do not teach this course." }, { status: 403 });
  if (!videoId) return Response.json({ error: "Lecture not found." }, { status: 404 });

  return transcriptProgressResponse(async (report) => {
    report({ stage: "fetching", message: "Fetching English captions from YouTube…" });
    try {
      const fetched = await fetchCaptions(videoId);
      const raw = toVtt(fetched.snippets);
      let parsed;
      try {
        parsed = parseTranscript(raw);
      } catch (error) {
        if (error instanceof TranscriptParseError) throw new Error("YouTube returned no usable English captions.");
        throw error;
      }

      const result = await ingestTranscript(session, lectureId, parsed, raw, report);
      const kind = fetched.isGenerated ? "auto-generated" : "human-created";
      const message = result.status === "indexed"
        ? `Fetched ${kind} ${fetched.language} captions and indexed ${result.chunks} passages.`
        : result.warning ?? "Captions were saved but could not be indexed.";
      report({ stage: "done", ...result, message });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const message = code
        ? ((await dbErrorResponse(error).json().catch(() => ({}))) as { error?: string }).error ?? "Transcript processing failed."
        : error instanceof Error ? error.message : "Caption fetch failed.";
      report({ stage: "error", error: message, message });
    }
  });
}
