import { requireApi, isResponse } from "@/lib/guard";
import { badRequest } from "@/lib/http";
import { parseYouTubeId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function durationSeconds(duration: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(duration);
  if (!match) return null;
  return Math.floor(
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0),
  );
}

export async function GET(req: Request) {
  const session = await requireApi(["instructor", "admin"]);
  if (isResponse(session)) return session;

  const videoId = parseYouTubeId(new URL(req.url).searchParams.get("video") ?? "");
  if (!videoId) return badRequest("Paste a valid YouTube link or 11-character video id.");
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "YouTube lookup is not configured. Add YOUTUBE_API_KEY to .env.local." }, { status: 503 });
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) {
      const reason = body.error?.errors?.[0]?.reason;
      const message = reason === "quotaExceeded"
        ? "YouTube API quota exceeded. You can still enter the lecture details manually."
        : "Could not fetch YouTube details. Check the video link and API key, or enter details manually.";
      return Response.json({ error: message }, { status: response.status === 404 ? 404 : 502 });
    }

    const video = body.items?.[0];
    if (!video) return Response.json({ error: "YouTube video not found or unavailable." }, { status: 404 });

    const seconds = durationSeconds(video.contentDetails?.duration ?? "");
    if (!seconds) return Response.json({ error: "YouTube did not return a valid video duration." }, { status: 422 });

    const description = String(video.snippet?.description ?? "");
    return Response.json({
      title: String(video.snippet?.title ?? "").slice(0, 200),
      description: description.slice(0, 1000),
      descriptionTruncated: description.length > 1000,
      durationSec: seconds,
      publishedAt: String(video.snippet?.publishedAt ?? "").slice(0, 10),
    });
  } catch {
    return Response.json({ error: "Could not reach YouTube. You can enter the lecture details manually." }, { status: 502 });
  }
}
