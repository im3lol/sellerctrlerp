"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { customers, suppliers, items, itemCategories, unitsOfMeasure, itemCodes } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { toCsv } from "@/lib/erp/csv";

// Full master-data CSV export (all rows, all business fields — org-scoped, so
// multi-tenant safe). Returns the CSV body; the client prepends the BOM + downloads.

export type ExportResult = { ok: true; csv: string; filename: string } | { ok: false; error: string };

const yn = (b: boolean) => (b ? "نعم" : "لا");
const stamp = () => new Date().toISOString().slice(0, 10);

/** Export every customer with full data. */
export async function exportCustomersCsvAction(): Promise<ExportResult> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(customers)
      .where(eq(customers.organizationId, auth.orgId)).orderBy(asc(customers.code));
    const headers = ["الكود", "الاسم", "الاسم (EN)", "الهاتف", "البريد", "العنوان", "الرصيد", "حد الائتمان", "مدة السداد (يوم)", "نشط"];
    const data = rows.map((c) => [c.code, c.nameAr, c.nameEn, c.phone, c.email, c.address, c.balance, c.creditLimit, c.paymentTerms, yn(c.isActive)]);
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
    const headers = ["الكود", "الاسم", "الاسم (EN)", "الهاتف", "البريد", "العنوان", "الرصيد", "مدة السداد (يوم)", "نشط"];
    const data = rows.map((s) => [s.code, s.nameAr, s.nameEn, s.phone, s.email, s.address, s.balance, s.paymentTerms, yn(s.isActive)]);
    return { ok: true, csv: toCsv(headers, data), filename: `suppliers-${stamp()}.csv` };
  });
}

/** Export every item with full data + all its codes (barcode/SKU/ASIN…). */
export async function exportItemsCsvAction(): Promise<ExportResult> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      code: items.code, nameAr: items.nameAr, nameEn: items.nameEn,
      category: itemCategories.nameAr, unit: unitsOfMeasure.nameAr,
      sellPrice: items.sellPrice, minStock: items.minStock, maxStock: items.maxStock,
      brand: items.brand, weight: items.weight, dimensions: items.dimensions,
      variationValue: items.variationValue, isActive: items.isActive, id: items.id,
    }).from(items)
      .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
      .leftJoin(unitsOfMeasure, eq(unitsOfMeasure.id, items.uomId))
      .where(eq(items.organizationId, auth.orgId)).orderBy(asc(items.code));

    // All codes per item in one query → "type:value" joined with " | ".
    const codesByItem = new Map<string, string[]>();
    if (rows.length) {
      const codeRows = await db.select({ itemId: itemCodes.itemId, codeType: itemCodes.codeType, code: itemCodes.code })
        .from(itemCodes).where(and(eq(itemCodes.organizationId, auth.orgId), inArray(itemCodes.itemId, rows.map((r) => r.id))));
      for (const c of codeRows) {
        const arr = codesByItem.get(c.itemId) ?? [];
        arr.push(`${c.codeType}:${c.code}`);
        codesByItem.set(c.itemId, arr);
      }
    }

    const headers = ["الكود", "الاسم", "الاسم (EN)", "التصنيف", "الوحدة", "سعر البيع", "الحد الأدنى", "الحد الأقصى", "العلامة التجارية", "الوزن", "الأبعاد", "المتغيّر", "الأكواد (باركود/SKU/ASIN)", "نشط"];
    const data = rows.map((i) => [
      i.code, i.nameAr, i.nameEn, i.category, i.unit, i.sellPrice, i.minStock, i.maxStock,
      i.brand, i.weight, i.dimensions, i.variationValue, (codesByItem.get(i.id) ?? []).join(" | "), yn(i.isActive),
    ]);
    return { ok: true, csv: toCsv(headers, data), filename: `items-${stamp()}.csv` };
  });
}
