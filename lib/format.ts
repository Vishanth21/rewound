// lib/format.ts
/** 83 -> "1:23", 3725 -> "1:02:05" */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "5:00" -> 300, "1:02:05" -> 3725, "90" -> 90; null if it is not a duration. */
export function parseDuration(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(:[0-5]?\d){0,2}$/.test(s)) return null;
  const secs = s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  return secs > 0 ? secs : null;
}

/** Cosine distance (0 = identical) -> a 0-100 "match" figure for display. */
export function matchPercent(distance: number): number {
  return Math.max(0, Math.min(100, Math.round((1 - distance) * 100)));
}

/** Splits text that contains [[[match]]] markers (from ts_headline) into plain/highlight parts. */
export function splitHighlights(text: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  const re = /\[\[\[(.*?)\]\]\]/gs;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}
