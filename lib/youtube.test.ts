import { describe, expect, it } from "vitest";
import { parseYouTubeId } from "./youtube";

describe("parseYouTubeId", () => {
  it("accepts a bare id", () => expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ"));
  it("accepts watch, short, embed and shorts URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects other hosts and malformed ids", () => {
    expect(parseYouTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("not a video")).toBeNull();
    expect(parseYouTubeId("https://youtu.be/short")).toBeNull();
  });
});
