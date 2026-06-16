/** Product fields needed to build the AI listing prompt. */
export type ListingProduct = {
  name: string;
  description: string | null;
  features: string | null;
  sizes: string | null;
  colors: string | null;
  brand: string | null;
  price: string | null;
  productUrl: string | null;
  imageUrl: string | null;
};

/**
 * Build a self-contained Markdown prompt+data document, ready to send directly
 * to any AI platform to generate a full product listing IN ENGLISH. The rules
 * forbid the AI from inventing anything not present in the provided data.
 */
export function buildListingMarkdown(p: ListingProduct): string {
  const row = (label: string, v: string | null) => `- **${label}:** ${v && v.trim() ? v.trim() : "N/A"}`;
  const imageBlock = p.imageUrl
    ? `\n![product image](${p.imageUrl})\n`
    : "";

  return `# Task: Write a COMPLETE, professional e-commerce product listing (in English)

You are an expert e-commerce copywriter and marketplace cataloguer. Produce a complete, ready-to-publish product listing **in English** for the product described under "Product Data" below.

## ⚠️ STRICT MANDATORY RULES — follow them exactly:
1. For all FACTUAL content (specifications, features, materials, measurements, claims): use ONLY the information in the "Product Data" section. Do NOT add or invent anything not explicitly stated.
2. If a piece of information is missing ("N/A"), omit it — do not assume, guess, or fabricate.
3. Do not exaggerate or promise anything not present in the data.
4. Classification fields (Category Nodes, Keywords, Search Terms, Tags, Target Audience, Product Type) MAY be recommended based on the product type — but must stay consistent with the data and must NOT imply specifications the product does not have.
5. Any violation of these rules is a serious error — follow them literally.

## Output (in English) — provide every section below, clearly labeled:
1. **Title** — catchy and keyword-rich; include the brand and key attributes (max 200 characters).
2. **Description** — 1–3 engaging marketing paragraphs, based only on the available data.
3. **Bullet Points (Key Features)** — 5 concise selling points derived only from the data.
4. **Specifications** — a clean table listing all provided specs (do not add specs that are not listed).
5. **Keywords / Search Terms** — relevant SEO keywords derived from the product name, type, and specs.
6. **Recommended Category Nodes** — the most fitting marketplace category path(s), e.g. "Fashion > Men > Watches > Wrist Watches" (a categorization recommendation based on the product type).
7. **Brand** — state the brand if identifiable from the data or product name; otherwise "Unknown".
8. **Additional Recommended Fields** — when helpful and consistent with the data: Target Audience, Product/Item Type, Material Highlights, Suggested Tags, and Backend Search Terms.

---

## Product Data
${row("Product Name", p.name)}
${row("Main Image", p.imageUrl)}
${row("Description", p.description)}
${row("Features", p.features)}
${row("Sizes", p.sizes)}
${row("Colors", p.colors)}
${row("Brand", p.brand)}
${row("Price", p.price)}
${row("Product URL", p.productUrl)}
${imageBlock}`;
}
