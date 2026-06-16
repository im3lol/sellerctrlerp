import * as XLSX from "xlsx";

/**
 * Excel import for products. The client fills a template (locked columns),
 * the team uploads it. Column headers are Arabic and matched by name.
 */
export const TEMPLATE_COLUMNS: { header: string; field: ParsedField }[] = [
  { header: "لينك الصورة", field: "imageUrl" },
  { header: "اسم المنتج", field: "name" },
  { header: "الوصف", field: "description" },
  { header: "المقاسات", field: "sizes" },
  { header: "المميزات", field: "features" },
  { header: "لينك كل الصور", field: "galleryUrl" },
  { header: "البراند", field: "brand" },
  { header: "السعر", field: "price" },
  { header: "الألوان", field: "colors" },
];

export type ParsedField =
  | "imageUrl"
  | "name"
  | "description"
  | "sizes"
  | "features"
  | "galleryUrl"
  | "brand"
  | "price"
  | "colors";

export type ParsedProduct = Partial<Record<ParsedField, string>>;

/** Build the downloadable .xlsx template (headers + one example row). */
export function buildTemplateBuffer(): Buffer {
  const headers = TEMPLATE_COLUMNS.map((c) => c.header);
  const example = [
    "https://example.com/product.jpg",
    "سماعة بلوتوث لاسلكية",
    "سماعة بلوتوث عالية الجودة مع إلغاء الضوضاء",
    "مقاس واحد",
    "بطارية 30 ساعة، مقاومة للماء",
    "https://drive.google.com/folder/...",
    "Anker",
    "199.00",
    "أسود، أبيض، أزرق",
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(() => ({ wch: 24 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "المنتجات");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Parse an uploaded .xlsx into product rows. Matches columns by Arabic header. */
export function parseProductsBuffer(buffer: Buffer): ParsedProduct[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const headerToField = new Map(TEMPLATE_COLUMNS.map((c) => [c.header.trim(), c.field]));

  const out: ParsedProduct[] = [];
  for (const row of rows) {
    const product: ParsedProduct = {};
    for (const [key, value] of Object.entries(row)) {
      const field = headerToField.get(String(key).trim());
      if (field) {
        const v = String(value ?? "").trim();
        if (v) product[field] = v;
      }
    }
    // Skip empty rows / rows without a name.
    if (product.name) out.push(product);
  }
  return out;
}
