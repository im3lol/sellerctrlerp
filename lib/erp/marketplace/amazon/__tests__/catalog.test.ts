import { describe, it, expect } from "vitest";
import { parseCatalog } from "../catalog";

describe("Catalog Items → CatalogRecord", () => {
  it("extracts image, brand, barcodes, dimensions, variation parent + value", () => {
    const res = {
      items: [
        {
          asin: "ASINCHILD",
          summaries: [{ itemName: "Widget Red L", brand: "Acme", color: "Red", size: "L" }],
          identifiers: [{ identifiers: [{ identifierType: "UPC", identifier: "012345678905" }, { identifierType: "EAN", identifier: "4006381333931" }] }],
          images: [{ images: [{ variant: "PT01", link: "https://x/pt.jpg" }, { variant: "MAIN", link: "https://x/main.jpg" }] }],
          dimensions: [{ item: { length: { value: 10, unit: "centimeters" }, width: { value: 5, unit: "centimeters" }, height: { value: 3, unit: "centimeters" }, weight: { value: 0.5, unit: "kilograms" } } }],
          relationships: [{ relationships: [{ parentAsins: ["ASINPARENT"] }] }],
        },
      ],
    };
    const out = parseCatalog(res);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      asin: "ASINCHILD", imageUrl: "https://x/main.jpg", brand: "Acme",
      // Metric, converted at the source: the catalogue's own units are Amazon's, not the
      // seller's, and weightKg is what freight-by-weight allocation actually divides by.
      weight: "500 جم", weightKg: 0.5, dimensions: "10 × 5 × 3 سم",
      parentAsin: "ASINPARENT", variationValue: "Red / L", name: "Widget Red L",
    });
    expect(out[0].identifiers).toEqual([{ type: "UPC", code: "012345678905" }, { type: "EAN", code: "4006381333931" }]);
  });

  it("converts a US catalogue's pounds and inches, and keeps the number", () => {
    const out = parseCatalog({
      items: [{
        asin: "USITEM",
        dimensions: [{ item: {
          length: { value: 9.055, unit: "inches" }, width: { value: 2.165, unit: "inches" },
          height: { value: 0.039, unit: "inches" }, weight: { value: 0.37, unit: "pounds" },
        } }],
      }],
    });
    expect(out[0]).toMatchObject({ weight: "168 جم", weightKg: 0.168, dimensions: "23 × 5.5 × 0.1 سم" });
  });

  it("records no weight at all when the catalogue does not know one", () => {
    // "0 pounds" is Amazon saying it has no figure. Storing 0 would look measured and
    // still contribute nothing to a freight split.
    const out = parseCatalog({
      items: [{ asin: "NOWEIGHT", dimensions: [{ item: { weight: { value: 0, unit: "pounds" } } }] }],
    });
    expect(out[0].weight).toBeUndefined();
  });

  it("handles a bare item (no enrichment data) and an empty response", () => {
    expect(parseCatalog({})).toEqual([]);
    const out = parseCatalog({ items: [{ asin: "A" }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ asin: "A", identifiers: [] });
    expect(out[0].parentAsin).toBeUndefined();
  });
});
