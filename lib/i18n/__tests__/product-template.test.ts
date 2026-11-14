import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildTemplateBuffer, parseProductsBuffer } from "@/lib/excel";

describe("bilingual product templates", () => {
  it("exports an English template that can be imported with English headers", () => {
    const buffer = buildTemplateBuffer("en");
    const workbook = XLSX.read(buffer);
    expect(workbook.SheetNames).toEqual(["Products"]);
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Products);
    expect(rows[0]["Product name"]).toBe("Wireless Bluetooth headphones");
    expect(parseProductsBuffer(buffer)[0].name).toBe("Wireless Bluetooth headphones");
  });
  it("keeps Arabic imports and customer-entered names intact", () => {
    expect(parseProductsBuffer(buildTemplateBuffer("ar"))[0].name).toBe("سماعة بلوتوث لاسلكية");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Product name", "Product description"], ["اسم خاص بالعميل", "وصف كتبه العميل"],
    ]), "Products");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    expect(parseProductsBuffer(buffer)[0]).toEqual({ name: "اسم خاص بالعميل", description: "وصف كتبه العميل" });
  });
});
