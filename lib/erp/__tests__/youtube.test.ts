import { describe, it, expect } from "vitest";
import { youtubeId, youtubeEmbedUrl, isEmbeddable } from "../youtube";

const ID = "dQw4w9WgXcQ";

describe("youtubeId", () => {
  it("reads every shape of link the owner might paste", () => {
    // The owner copies whatever the browser/share button gives them — all of these
    // are the same video, and all must play.
    expect(youtubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(youtubeId(`https://youtube.com/embed/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youtubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });

  it("survives the share-link junk", () => {
    // youtu.be adds ?si=, "copy at current time" adds ?t=, and v= isn't always first.
    expect(youtubeId(`https://youtu.be/${ID}?si=abc123&t=42`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/watch?t=90&v=${ID}&list=PLxx`)).toBe(ID);
  });

  it("trims — a pasted link often carries whitespace", () => {
    expect(youtubeId(`  https://youtu.be/${ID}  `)).toBe(ID);
  });

  it("returns null for a non-YouTube video link rather than faking an embed", () => {
    // Vimeo/Drive are valid links; they just can't embed this way, and the page must
    // fall back to a plain link instead of rendering an empty player.
    expect(youtubeId("https://vimeo.com/123456")).toBeNull();
    expect(youtubeId("https://drive.google.com/file/d/abc/view")).toBeNull();
  });

  it("rejects a malformed id instead of building a dead embed", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeId("https://youtu.be/way-too-long-to-be-an-id")).toBeNull();
    expect(youtubeId("https://www.youtube.com/watch?v=bad!chars!!")).toBeNull();
  });

  it("a YouTube page that isn't a video is not a video", () => {
    expect(youtubeId("https://www.youtube.com/")).toBeNull();
    expect(youtubeId("https://www.youtube.com/@somechannel")).toBeNull();
    expect(youtubeId("https://www.youtube.com/playlist?list=PLxxxx")).toBeNull();
  });

  it("refuses lookalike hosts and non-http schemes", () => {
    // youtube.com.evil.tld must not be treated as YouTube.
    expect(youtubeId(`https://youtube.com.evil.tld/watch?v=${ID}`)).toBeNull();
    expect(youtubeId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
    expect(youtubeId(`javascript:alert(1)//youtu.be/${ID}`)).toBeNull();
  });

  it("handles empty/garbage without throwing", () => {
    expect(youtubeId(null)).toBeNull();
    expect(youtubeId(undefined)).toBeNull();
    expect(youtubeId("")).toBeNull();
    expect(youtubeId("not a url at all")).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("uses the no-cookie host", () => {
    // Tracking cookies shouldn't be set on a customer just for opening a lesson.
    expect(youtubeEmbedUrl(ID)).toContain("youtube-nocookie.com/embed/");
    expect(youtubeEmbedUrl(ID)).toContain(ID);
  });
});

describe("isEmbeddable", () => {
  it("decides player vs plain link", () => {
    expect(isEmbeddable(`https://youtu.be/${ID}`)).toBe(true);
    expect(isEmbeddable("https://vimeo.com/1")).toBe(false);
    expect(isEmbeddable(null)).toBe(false);
  });
});
