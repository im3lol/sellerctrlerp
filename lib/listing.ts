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

  return `# Task: Create an Amazon-ready product listing (English)

You are a senior **Amazon listing specialist and cataloguing expert**. Produce a complete, **policy-compliant Amazon listing in English** for the product in "Product Data" below, following Amazon's official listing guidelines, title/bullet style, and category requirements.

## ⚠️ STRICT RULES — follow them exactly:
1. FACTUAL content (specifications, features, materials, measurements, claims): use ONLY the "Product Data". Never invent, assume, or fabricate.
2. If information is missing ("N/A"): omit it, or mark a structured attribute as "Not provided". Do not guess.
3. Follow Amazon policies strictly:
   - Title: NO promotional words or claims (no "best", "sale", "free shipping", "#1", "guaranteed", "new"), NO price, NO seller/contact info, NO URLs/emails/phone numbers, NO ALL-CAPS words, NO emojis or decorative symbols.
   - Bullets & description: factual, no promotional/time-sensitive claims, no pricing, no shipping/warranty claims unless explicitly in the data.
4. Classification fields (browse node, keywords, structured attributes) MAY be recommended from the product type, but must stay consistent with the data and must NOT imply specs the product lacks.
5. Any violation is a serious error — follow literally.

## Output — Amazon listing fields (English), each clearly labeled:
1. **Product Title** — Amazon style: Brand + Model + Product Type + key attributes, Title Case, ~80–200 characters; compliant with rule 3.
2. **About This Item (5 bullet points)** — each begins with a capitalized benefit/feature phrase; concise; only from data.
3. **Product Description** — 1–3 plain-text paragraphs suitable for Amazon; only from data.
4. **Backend Search Terms** — a single line, ≤ ~250 bytes, lowercase, space-separated, no commas, no brand names, no competitor names, no words already in the title.
5. **Recommended Browse Node / Category Path** — best-fit Amazon category, e.g. "Clothing, Shoes & Jewelry > Men > Watches > Wrist Watches".
6. **Key Product Attributes (structured)** — the fields Amazon expects for this category as a table (e.g., for watches: Brand, Model Number, Item Type, Department/Target Gender, Case Material, Band Material, Movement, Water Resistance, Case Diameter, Glass/Display, Clasp Type, Item Weight). Fill ONLY from data; mark the rest "Not provided".
7. **Brand** — from the data/product name; if none, "Generic".
8. **Compliance Notes** — flag any required attribute that is missing and anything that may need review for Amazon policy.

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
