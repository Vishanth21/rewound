import { z } from "zod";
import { withUser } from "@/lib/db";
import { requireApi, isResponse } from "@/lib/guard";
import { badRequest, dbErrorResponse } from "@/lib/http";
import { canManageCourse, parseId } from "@/lib/manage";
import { parseYouTubePlaylistId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestBody = z.object({ playlist: z.string().trim().min(1).max(500) });
const MAX_IMPORT = 500;

type PlaylistItem = { snippet?: { resourceId?: { videoId?: string } } };
type Video = {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string };
  contentDetails?: { duration?: string };
};

function durationSeconds(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return null;
  const seconds = Math.floor(
    Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0),
  );
  return seconds > 0 && seconds <= 86400 ? seconds : null;
}

async function youtubeGet<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") throw new Error("YouTube API quota exceeded.");
    if (response.status === 404 || reason === "playlistNotFound") throw new Error("Playlist not found or unavailable.");
    throw new Error("Could not read this playlist from YouTube. Check that it is public and that the API key is valid.");
  }
  return body as T;
}

async function getPlaylistVideoIds(playlistId: string, apiKey: string): Promise<string[]> {
  const videoIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await youtubeGet<{ items?: PlaylistItem[]; nextPageToken?: string }>("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50",
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const item of page.items ?? []) {
      const id = item.snippet?.resourceId?.videoId;
      if (id) videoIds.push(id);
    }
    if (videoIds.length > MAX_IMPORT) throw new Error(`This playlist has more than ${MAX_IMPORT} videos. Import a smaller playlist.`);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return videoIds;
}

async function getVideos(videoIds: string[], apiKey: string): Promise<Map<string, Video>> {
  const videos = new Map<string, Video>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const page = await youtubeGet<{ items?: Video[] }>("videos", {
      part: "snippet,contentDetails",
      id: videoIds.slice(i, i + 50).join(","),
      key: apiKey,
    });
    for (const video of page.items ?? []) videos.set(video.id, video);
  }
  return videos;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;
  const { id: rawId } = await params;
  const courseId = parseId(rawId);
  if (!courseId) return badRequest("Invalid course id.");
  const parsedBody = RequestBody.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return badRequest("Paste a YouTube playlist URL or playlist ID.");
  const playlistId = parseYouTubePlaylistId(parsedBody.data.playlist);
  if (!playlistId) return badRequest("Paste a valid YouTube playlist URL or playlist ID.");
  const canManage = await withUser(session.user.id, (c) => canManageCourse(c, session, courseId));
  if (!canManage) return Response.json({ error: "You do not teach this course." }, { status: 403 });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return Response.json({ error: "YouTube playlist import needs YOUTUBE_API_KEY in .env.local." }, { status: 503 });

  try {
    const ids = await getPlaylistVideoIds(playlistId, apiKey);
    if (ids.length === 0) return Response.json({ error: "This playlist has no available videos." }, { status: 422 });
    const videos = await getVideos(ids, apiKey);
    const seen = new Set<string>();
    const candidates: { videoId: string; title: string; description: string; duration: number; publishedAt: string | null }[] = [];
    let unavailable = 0;
    let unsupportedDuration = 0;

    for (const videoId of ids) {
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      const video = videos.get(videoId);
      if (!video) {
        unavailable++;
        continue;
      }
      const duration = durationSeconds(video.contentDetails?.duration ?? "");
      if (!duration) {
        unsupportedDuration++;
        continue;
      }
      const publishedAt = video.snippet?.publishedAt?.slice(0, 10) ?? null;
      candidates.push({
        videoId,
        title: (video.snippet?.title ?? "").trim().slice(0, 200) || "Untitled lecture",
        description: (video.snippet?.description ?? "").trim().slice(0, 1000),
        duration,
        publishedAt: publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? publishedAt : null,
      });
    }

    const result = await withUser(session.user.id, async (c) => {
      if (!(await canManageCourse(c, session, courseId))) return { forbidden: true as const };
      const existing = (await c.query("SELECT lecture_no, youtube_video_id FROM course_lectures($1)", [courseId])).rows;
      const existingIds = new Set(existing.map((row) => String(row.youtube_video_id).trim()));
      let nextNo = existing.reduce((max, row) => Math.max(max, Number(row.lecture_no)), 0) + 1;
      const firstLectureNo = nextNo;
      let alreadyInCourse = 0;
      let numberLimit = 0;
      let imported = 0;

      for (const video of candidates) {
        if (existingIds.has(video.videoId)) {
          alreadyInCourse++;
          continue;
        }
        if (nextNo > 999) {
          numberLimit++;
          continue;
        }
        await c.query(
          `INSERT INTO lecture (course_id, lecture_no, title, youtube_video_id, duration_sec, delivered_on, description, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [courseId, nextNo, video.title, video.videoId, video.duration, video.publishedAt, video.description || null, session.user.id],
        );
        existingIds.add(video.videoId);
        nextNo++;
        imported++;
      }
      return { forbidden: false as const, imported, firstLectureNo, alreadyInCourse, unavailable, unsupportedDuration, numberLimit };
    });

    if (result.forbidden) return Response.json({ error: "You do not teach this course." }, { status: 403 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if ((error as { code?: string })?.code) return dbErrorResponse(error);
    const message = error instanceof Error ? error.message : "Playlist import failed.";
    const status = message.includes("more than") ? 413 : 502;
    return Response.json({ error: message }, { status });
  }
}
