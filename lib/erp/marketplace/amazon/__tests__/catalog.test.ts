import { describe, it, expect } from "vitest";
import { parseCatalogImages } from "../catalog";

describe("Catalog Items → image URLs", () => {
  it("prefers the MAIN variant, falls back to the first, skips items with no images", () => {
    const res = {
      items: [
        { asin: "ASIN1", images: [{ marketplaceId: "X", images: [{ variant: "PT01", link: "https://x/pt01.jpg" }, { variant: "MAIN", link: "https://x/main.jpg" }] }] },
        { asin: "ASIN2", images: [{ images: [{ variant: "PT01", link: "https://x/a2.jpg" }] }] },
        { asin: "ASIN3" },
      ],
    };
    const out = parseCatalogImages(res);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ asin: "ASIN1", imageUrl: "https://x/main.jpg" });
    expect(out).toContainEqual({ asin: "ASIN2", imageUrl: "https://x/a2.jpg" });
  });

  it("handles an empty response", () => {
    expect(parseCatalogImages({})).toEqual([]);
  });
});
