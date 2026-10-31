// lib/transcript-parse.ts  (Member A)
// Parses .srt and .vtt caption files into [{ start, end, text }] cues, in seconds.
// The cues go to the ingest_transcript() stored procedure, which does the chunking.
//
// Handles: BOM, CRLF/CR line endings, SRT "," vs VTT "." milliseconds, optional hours,
// cue numbers/ids, cue settings after the timestamps, NOTE/STYLE/REGION blocks, multi-line
// cues, <i>/<b>/<c.color>/<v Name> styling tags, HTML entities, zero-length cues,
// out-of-order cues, and YouTube's "rolling" auto-captions that repeat the previous line.

export type Cue = { start: number; end: number; text: string };
export type ParsedTranscript = { format: "srt" | "vtt"; segments: Cue[] };

export class TranscriptParseError extends Error {}

const TIME = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
const TIMING = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[g.toLowerCase()] ?? whole;
  });
}

function cleanLine(line: string): string {
  return decodeEntities(line.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export function detectFormat(raw: string): "srt" | "vtt" {
  return /^﻿?\s*WEBVTT/.test(raw) ? "vtt" : "srt";
}

export function parseTranscript(raw: string): ParsedTranscript {
  const format = detectFormat(raw);
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n[ \t]*\n/);

  let cues: { start: number; end: number; lines: string[] }[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at === -1) continue; // header, NOTE, STYLE, REGION, or a stray index
    const m = TIMING.exec(lines[at])!;
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    const bodyLines = lines.slice(at + 1).map(cleanLine).filter(Boolean);
    if (bodyLines.length === 0) continue;
    cues.push({ start, end, lines: bodyLines });
  }
  if (cues.length === 0) throw new TranscriptParseError("No captions found. Upload a valid .srt or .vtt file.");

  // Rolling auto-captions: drop lines that the previous cue already showed.
  cues.sort((a, b) => a.start - b.start); // stable sort keeps file order for equal starts
  const deduped: { start: number; end: number; text: string }[] = [];
  let prevLines: string[] = [];
  for (const c of cues) {
    const fresh = c.lines.filter((l) => !prevLines.includes(l));
    prevLines = c.lines;
    if (fresh.length === 0) {
      if (deduped.length) deduped[deduped.length - 1].end = Math.max(deduped[deduped.length - 1].end, c.end);
      continue;
    }
    deduped.push({ start: c.start, end: c.end, text: fresh.join(" ") });
  }

  // The database needs end > start and non-decreasing starts; repair zero/negative durations.
  const segments: Cue[] = deduped.map((c, i) => {
    let end = c.end;
    if (!(end > c.start)) {
      const next = deduped[i + 1]?.start;
      end = next !== undefined && next > c.start ? Math.min(next, c.start + 2) : c.start + 0.5;
    }
    return { start: round(c.start), end: round(end), text: c.text };
  });
  if (segments.length === 0) throw new TranscriptParseError("The file contained timing lines but no caption text.");
  return { format, segments };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
