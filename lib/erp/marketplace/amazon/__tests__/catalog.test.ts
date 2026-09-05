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
      // Dimensions are converted to centimetres; the weight is deliberately not taken.
      dimensions: "10 × 5 × 3 سم",
      parentAsin: "ASINPARENT", variationValue: "Red / L", name: "Widget Red L",
    });
    expect(out[0].identifiers).toEqual([{ type: "UPC", code: "012345678905" }, { type: "EAN", code: "4006381333931" }]);
  });

  it("converts a US catalogue's inches to centimetres", () => {
    const out = parseCatalog({
      items: [{
        asin: "USITEM",
        dimensions: [{ item: {
          length: { value: 9.055, unit: "inches" }, width: { value: 2.165, unit: "inches" },
          height: { value: 0.039, unit: "inches" },
        } }],
      }],
    });
    expect(out[0]).toMatchObject({ dimensions: "23 × 5.5 × 0.1 سم" });
  });

  it("never takes a weight from the catalogue, even when one is offered", () => {
    // The catalogue reports the manufacturer's product weight. Freight-by-weight
    // allocation divides by items.weightKg, so a figure that is not what actually ships
    // would quietly misprice every shipment. The seller enters that number.
    const out = parseCatalog({
      items: [{ asin: "HASWEIGHT", dimensions: [{ item: { weight: { value: 0.37, unit: "pounds" } } }] }],
    });
    expect(out[0]).not.toHaveProperty("weight");
    expect(out[0]).not.toHaveProperty("weightKg");
  });

  it("handles a bare item (no enrichment data) and an empty response", () => {
    expect(parseCatalog({})).toEqual([]);
    const out = parseCatalog({ items: [{ asin: "A" }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ asin: "A", identifiers: [] });
    expect(out[0].parentAsin).toBeUndefined();
  });
});
