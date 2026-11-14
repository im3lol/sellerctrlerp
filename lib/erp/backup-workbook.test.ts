import { gzipSync } from "node:zlib";
import * as XLSX from "xlsx";
import { expect, it } from "vitest";
import { buildBackupWorkbook, buildBackupSheets, backupFolderName } from "./backup-workbook";

const payload = (data: Record<string, unknown[]>) => gzipSync(JSON.stringify({ meta: { orgId: "own", orgName: "Company", exportedAt: "2026-11-13T12:00:00Z" }, data }));
it("makes a readable, linked workbook from the same snapshot without leaking secrets", () => {
  const source = payload({ items: [{ id: "item-id", organization_id: "own", code: "000123", name_ar: "صنف", sell_price: "25.50", secret_token: "hidden" }], stock_movements: [{ id: "movement", organization_id: "own", item_id: "item-id", quantity: "2" }], platform_credentials: [{ id: "credential", organization_id: "own", refresh_token: "hidden" }], customers: [] });
  const result = buildBackupWorkbook(source, "own");
  const wb = XLSX.read(result.buffer, { type: "buffer" });
  expect(wb.SheetNames).toEqual(["ملخص النسخة", "الأصناف", "حركات المخزون"]);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["الأصناف"], { header: 1 }) as unknown[][];
  expect(rows[0]).toContain("سعر البيع");expect(rows[1]).toContain("000123");expect(rows[1]).toContain(25.5);
  expect(JSON.stringify(rows)).not.toContain("hidden");
  expect(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets["حركات المخزون"]))).toContain("000123 · صنف");
  expect(result.totalRows).toBe(2);expect(result.sheetCount).toBe(2);
});
it("rejects a wrong organization and rows from another tenant", () => {
  expect(() => buildBackupWorkbook(payload({ items: [] }), "foreign")).toThrow("organization mismatch");
  expect(() => buildBackupWorkbook(payload({ items: [{ organization_id: "foreign" }] }), "own")).toThrow("Foreign organization");
});
it("keeps formula-like data as text, preserves precision and scrubs nested credentials", () => {
  const result = buildBackupWorkbook(payload({ items: [{ id: "i", organization_id: "own", name_ar: "=IMPORTXML(\"https://example.test\")", sell_price: "1234567890123456.1234", metadata: { safe: "yes", access_token: "private" }, notes: "x".repeat(40000) }] }), "own");
  const wb = XLSX.read(result.buffer, { type: "buffer" });const ws = wb.Sheets["الأصناف"];
  for (const [key, cell] of Object.entries(ws)) if (!key.startsWith("!")) expect(cell.f).toBeUndefined();
  const json = JSON.stringify(XLSX.utils.sheet_to_json(ws));
  expect(json).toContain("1234567890123456.1234");expect(json).not.toContain("private");expect(result.truncatedCells).toBe(1);
});
it("keeps long or conflicting sheet names valid", () => {
  const data = Object.fromEntries(["a".repeat(40), "a".repeat(39)+"b"].map(name => [name, [{ id: name, organization_id: "own" }]]));
  const wb = XLSX.read(buildBackupWorkbook(payload(data), "own", "en").buffer, { type: "buffer" });
  expect(new Set(wb.SheetNames).size).toBe(3);expect(wb.SheetNames.every(name => name.length <= 31)).toBe(true);
});

it("creates separate single-sheet files and a summary, retaining identifiers and tenant checks", () => {
 const source=payload({items:[{id:"i",organization_id:"own",code:"000123"}],customers:[{id:"c",organization_id:"own",name_ar:"عميل"}],suppliers:[]});
 const result=buildBackupSheets(source,"own");
 expect(result.files.map(f=>f.name)).toEqual(["ملخص النسخة","العملاء","الأصناف"]);
 for(const file of result.files) expect(XLSX.read(file.buffer,{type:"buffer"}).SheetNames).toEqual([file.name]);
 expect(JSON.stringify(XLSX.utils.sheet_to_json(XLSX.read(result.files.find(f=>f.name==="الأصناف")!.buffer,{type:"buffer"}).Sheets["الأصناف"]))).toContain("000123");
 expect(()=>buildBackupSheets(source,"foreign")).toThrow("organization mismatch");
 expect(backupFolderName("2026-11-14T10:15:30Z")).toBe("2026-11-14 12-15-30");
 expect(()=>backupFolderName("bad")).toThrow();
});
