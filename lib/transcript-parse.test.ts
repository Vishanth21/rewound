import { describe, expect, it } from "vitest";
import { detectFormat, parseTranscript, TranscriptParseError } from "./transcript-parse";

describe("parseTranscript: SRT", () => {
  it("parses a basic SRT with comma milliseconds and cue numbers", () => {
    const r = parseTranscript("1\n00:00:01,000 --> 00:00:03,500\nHello world.\n\n2\n00:00:04,000 --> 00:00:06,250\nSecond cue.\n");
    expect(r.format).toBe("srt");
    expect(r.segments).toEqual([
      { start: 1, end: 3.5, text: "Hello world." },
      { start: 4, end: 6.25, text: "Second cue." },
    ]);
  });

  it("handles a UTF-8 BOM and CRLF line endings", () => {
    const r = parseTranscript("﻿1\r\n00:00:00,000 --> 00:00:02,000\r\nFirst\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,000\r\nSecond\r\n");
    expect(r.segments.map((s) => s.text)).toEqual(["First", "Second"]);
  });

  it("joins multi-line cues into one line of text", () => {
    const r = parseTranscript("1\n00:00:00,000 --> 00:00:04,000\nline one\nline two\n");
    expect(r.segments[0].text).toBe("line one line two");
  });

  it("strips styling tags and decodes HTML entities", () => {
    const r = parseTranscript("1\n00:00:00,000 --> 00:00:02,000\n<i>Tom &amp; Jerry</i> <font color=\"#fff\">say &quot;hi&quot;</font> &#39;ok&#39;\n");
    expect(r.segments[0].text).toBe("Tom & Jerry say \"hi\" 'ok'");
  });

  it("converts hours, minutes, seconds and short millisecond fields", () => {
    const r = parseTranscript("1\n01:02:03,5 --> 01:02:05,25\nlate\n");
    expect(r.segments[0].start).toBeCloseTo(3723.5);
    expect(r.segments[0].end).toBeCloseTo(3725.25);
  });
});

describe("parseTranscript: VTT", () => {
  it("detects WEBVTT and accepts timestamps without hours and with dot milliseconds", () => {
    const raw = "WEBVTT\n\n00:01.000 --> 00:03.000\nShort form\n\n00:00:04.000 --> 00:00:06.000\nLong form\n";
    expect(detectFormat(raw)).toBe("vtt");
    const r = parseTranscript(raw);
    expect(r.segments).toEqual([
      { start: 1, end: 3, text: "Short form" },
      { start: 4, end: 6, text: "Long form" },
    ]);
  });

  it("ignores the header, NOTE, STYLE and REGION blocks and cue identifiers", () => {
    const raw = "WEBVTT - title\nKind: captions\n\nNOTE this is a comment\nmore comment\n\nSTYLE\n::cue { color: red }\n\nintro-1\n00:00:00.000 --> 00:00:02.000 align:start position:0%\nHi there\n";
    const r = parseTranscript(raw);
    expect(r.segments).toEqual([{ start: 0, end: 2, text: "Hi there" }]);
  });

  it("removes voice tags and inline timestamps from auto-captions", () => {
    const raw = "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v Prof>so today<00:00:01.000><c> we study</c><00:00:02.000><c> locks</c>\n";
    expect(parseTranscript(raw).segments[0].text).toBe("so today we study locks");
  });

  it("de-duplicates YouTube rolling captions that repeat the previous line", () => {
    const raw = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nfirst line\n\n00:00:02.000 --> 00:00:04.000\nfirst line\nsecond line\n\n00:00:04.000 --> 00:00:06.000\nsecond line\nthird line\n";
    expect(parseTranscript(raw).segments.map((s) => s.text)).toEqual(["first line", "second line", "third line"]);
  });
});

describe("parseTranscript: repairs and errors", () => {
  it("repairs zero-length cues so end is after start", () => {
    const r = parseTranscript("1\n00:00:05,000 --> 00:00:05,000\nblink\n\n2\n00:00:06,000 --> 00:00:08,000\nnext\n");
    expect(r.segments[0].end).toBeGreaterThan(r.segments[0].start);
    expect(r.segments[0].end).toBeLessThanOrEqual(6);
  });

  it("sorts out-of-order cues by start time", () => {
    const r = parseTranscript("1\n00:00:10,000 --> 00:00:12,000\nb\n\n2\n00:00:01,000 --> 00:00:03,000\na\n");
    expect(r.segments.map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("skips cues that have no text", () => {
    const r = parseTranscript("1\n00:00:00,000 --> 00:00:02,000\n\n\n2\n00:00:02,000 --> 00:00:04,000\nreal\n");
    expect(r.segments).toHaveLength(1);
  });

  it("throws a readable error for a file with no captions", () => {
    expect(() => parseTranscript("just some random text")).toThrow(TranscriptParseError);
    expect(() => parseTranscript("")).toThrow(/No captions found/);
  });
});
