// lib/youtube.ts  (Member A)
// Accepts a bare 11-character video id or any common YouTube URL and returns the id.
const ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,128}$/;

export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
        id = m ? m[1] : null;
      }
    }
    return id && ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function parseYouTubePlaylistId(input: string): string | null {
  const value = input.trim();
  if (PLAYLIST_ID.test(value)) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (!["youtube.com", "youtube-nocookie.com"].includes(host)) return null;
    const id = url.searchParams.get("list");
    return id && PLAYLIST_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}
