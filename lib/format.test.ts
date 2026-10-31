import { describe, expect, it } from "vitest";
import { matchPercent, mmss, parseDuration, splitHighlights } from "./format";

describe("mmss", () => {
  it("formats minutes and hours", () => {
    expect(mmss(83)).toBe("1:23");
    expect(mmss(3725)).toBe("1:02:05");
    expect(mmss(-4)).toBe("0:00");
  });
});

describe("parseDuration", () => {
  it("accepts seconds, m:ss and h:mm:ss", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("5:00")).toBe(300);
    expect(parseDuration(" 1:02:05 ")).toBe(3725);
  });
  it("rejects zero, bad seconds and junk", () => {
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("5:75")).toBeNull();
    expect(parseDuration("five")).toBeNull();
  });
});

describe("matchPercent and splitHighlights", () => {
  it("clamps distance to 0-100", () => {
    expect(matchPercent(0.2)).toBe(80);
    expect(matchPercent(1.5)).toBe(0);
  });
  it("splits ts_headline markers without producing HTML", () => {
    expect(splitHighlights("the [[[BCNF]]] form")).toEqual([
      { text: "the ", hit: false },
      { text: "BCNF", hit: true },
      { text: " form", hit: false },
    ]);
  });
});
