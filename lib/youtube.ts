// lib/youtube.ts  (Member A)
// Accepts a bare 11-character video id or any common YouTube URL and returns the id.
const ID = /^[A-Za-z0-9_-]{11}$/;

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
