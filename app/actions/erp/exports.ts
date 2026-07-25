"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { customers, suppliers, items, itemCategories, unitsOfMeasure, itemCodes, warehouses } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { toCsv } from "@/lib/erp/csv";
import { WAREHOUSE_TYPE_LABEL } from "@/lib/erp/warehouse-types";

// Full master-data CSV export (all rows, all business fields — org-scoped, so
// multi-tenant safe). Returns the CSV body; the client prepends the BOM + downloads.

export type ExportResult = { ok: true; csv: string; filename: string } | { ok: false; error: string };

const yn = (b: boolean) => (b ? "نعم" : "لا");
const stamp = () => new Date().toISOString().slice(0, 10);

// Preferred code-column order; any other codeType present is appended after these.
const CODE_ORDER = ["BARCODE", "SKU", "ASIN", "UPC", "EAN", "FNSKU", "AMAZON", "NOON", "OTHER"];
const CODE_LABEL: Record<string, string> = { BARCODE: "باركود", SKU: "SKU", ASIN: "ASIN", UPC: "UPC", EAN: "EAN", FNSKU: "FNSKU", AMAZON: "كود أمازون", NOON: "كود نون", OTHER: "أخرى" };

/** Export every customer with full data. */
export async function exportCustomersCsvAction(): Promise<ExportResult> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(customers)
      .where(eq(customers.organizationId, auth.orgId)).orderBy(asc(customers.code));
    const headers = ["الكود", "الاسم", "الهاتف", "البريد", "العنوان", "الرصيد", "حد الائتمان", "مدة السداد (يوم)", "نشط"];
    const data = rows.map((c) => [c.code, c.nameAr, c.phone, c.email, c.address, c.balance, c.creditLimit, c.paymentTerms, yn(c.isActive)]);
    return { ok: true, csv: toCsv(headers, data), filename: `customers-${stamp()}.csv` };
  });
}

/** Export every supplier with full data. */
export async function exportSuppliersCsvAction(): Promise<ExportResult> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(suppliers)
      .where(eq(suppliers.organizationId, auth.orgId)).orderBy(asc(suppliers.code));
    const headers = ["الكود", "الاسم", "الهاتف", "البريد", "العنوان", "الرصيد", "مدة السداد (يوم)", "نشط"];
    const data = rows.map((s) => [s.code, s.nameAr, s.phone, s.email, s.address, s.balance, s.paymentTerms, yn(s.isActive)]);
    return { ok: true, csv: toCsv(headers, data), filename: `suppliers-${stamp()}.csv` };
  });
}

/** Export every warehouse with its hierarchy (parent by code) + level type. */
export async function exportWarehousesCsvAction(): Promise<ExportResult> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(warehouses)
      .where(eq(warehouses.organizationId, auth.orgId)).orderBy(asc(warehouses.code));
    const codeById = new Map(rows.map((w) => [w.id, w.code]));
    const headers = ["الكود", "الاسم", "النوع", "كود الأب", "الموقع", "المسؤول", "نشط"];
    const data = rows.map((w) => [
      w.code, w.nameAr, WAREHOUSE_TYPE_LABEL[w.type] ?? w.type,
      w.parentId ? codeById.get(w.parentId) ?? "" : "", w.location, w.manager, yn(w.isActive),
    ]);
    return { ok: true, csv: toCsv(headers, data), filename: `warehouses-${stamp()}.csv` };
  });
}

/** Export every item with full data + all its codes (barcode/SKU/ASIN…). */
export async function exportItemsCsvAction(): Promise<ExportResult> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      code: items.code, nameAr: items.nameAr,
      category: itemCategories.nameAr, unit: unitsOfMeasure.nameAr,
      sellPrice: items.sellPrice, minStock: items.minStock, maxStock: items.maxStock,
      brand: items.brand, weight: items.weight, dimensions: items.dimensions,
      variationValue: items.variationValue, isActive: items.isActive, id: items.id,
    }).from(items)
      .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
      .leftJoin(unitsOfMeasure, eq(unitsOfMeasure.id, items.uomId))
      .where(eq(items.organizationId, auth.orgId)).orderBy(asc(items.code));

    // All codes per item → one COLUMN per code type (باركود/SKU/ASIN/…). Multiple
    // codes of the same type on one item are joined with " | ".
    const byItemType = new Map<string, Map<string, string[]>>();
    const typesPresent = new Set<string>();
    if (rows.length) {
      const codeRows = await db.select({ itemId: itemCodes.itemId, codeType: itemCodes.codeType, code: itemCodes.code })
        .from(itemCodes).where(and(eq(itemCodes.organizationId, auth.orgId), inArray(itemCodes.itemId, rows.map((r) => r.id))));
      for (const c of codeRows) {
        typesPresent.add(c.codeType);
        let m = byItemType.get(c.itemId);
        if (!m) { m = new Map(); byItemType.set(c.itemId, m); }
        const arr = m.get(c.codeType) ?? [];
        arr.push(c.code);
        m.set(c.codeType, arr);
      }
    }
    // Stable column order: preferred types first, then any others alphabetically.
    const codeTypes = [
      ...CODE_ORDER.filter((t) => typesPresent.has(t)),
      ...[...typesPresent].filter((t) => !CODE_ORDER.includes(t)).sort(),
    ];

    const headers = ["الكود", "الاسم", "التصنيف", "الوحدة", "سعر البيع", "الحد الأدنى", "الحد الأقصى", "العلامة التجارية", "الوزن", "الأبعاد", "المتغيّر", "نشط", ...codeTypes.map((t) => CODE_LABEL[t] ?? t)];
    const data = rows.map((i) => [
      i.code, i.nameAr, i.category, i.unit, i.sellPrice, i.minStock, i.maxStock,
      i.brand, i.weight, i.dimensions, i.variationValue, yn(i.isActive),
      ...codeTypes.map((t) => (byItemType.get(i.id)?.get(t) ?? []).join(" | ")),
    ]);
    return { ok: true, csv: toCsv(headers, data), filename: `items-${stamp()}.csv` };
  });
}
