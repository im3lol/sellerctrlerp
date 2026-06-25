"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, items } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getErpRole } from "@/lib/erp/auth-guard";

export type ImportResult = {
  inserted: number;
  updated: number;
  errors: { row: number; message: string }[];
  total: number;
};

async function authorize(_perm: "sales.create" | "inventory.create"): Promise<{ error: string } | { orgId: string }> {
  const { user, org } = await getActiveOrg();
  if (!user) return { error: "غير مصرح" };
  if (!org)  return { error: "لم يتم تحديد المؤسسة" };
  const role = await getErpRole(org.id, user);
  if (!role) return { error: "غير مصرح بالوصول" };
  return { orgId: org.id };
}

function parseCSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const cells: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuote = !inQuote; continue; }
        if (ch === "," && !inQuote) { cells.push(cur.trim()); cur = ""; continue; }
        cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    });
}

export async function importCustomersCSV(csvText: string): Promise<ImportResult | { error: string }> {
  const auth = await authorize("sales.create");
  if ("error" in auth) return auth;
  const { orgId } = auth;

  const rows = parseCSV(csvText);
  if (rows.length === 0) return { inserted: 0, updated: 0, errors: [], total: 0 };

  // Detect header: code, nameAr, phone, email, creditLimit, paymentTerms
  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const dataRows = header.includes("code") || header.includes("الكود") ? rows.slice(1) : rows;

  const col = (row: string[], names: string[]) => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx !== -1) return row[idx] ?? "";
    }
    return row[0] ?? ""; // fallback to first column
  };

  const result: ImportResult = { inserted: 0, updated: 0, errors: [], total: dataRows.length };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;
    const code = col(row, ["code", "الكود", "كود"]).trim();
    const nameAr = col(row, ["namear", "الاسم", "اسم"]).trim();
    if (!code) { result.errors.push({ row: rowNum, message: "الكود مطلوب" }); continue; }
    if (!nameAr) { result.errors.push({ row: rowNum, message: "الاسم مطلوب" }); continue; }

    const phone = col(row, ["phone", "هاتف", "الهاتف"]).trim() || null;
    const email = col(row, ["email", "بريد", "البريد"]).trim() || null;
    const creditLimit = parseFloat(col(row, ["creditlimit", "حدائتماني", "حدالائتمان"])) || 0;
    const paymentTerms = parseInt(col(row, ["paymentterms", "مدةالسداد", "مدة"])) || 30;

    try {
      const existing = await db.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.organizationId, orgId), eq(customers.code, code))).limit(1);

      if (existing.length > 0) {
        await db.update(customers).set({ nameAr, phone, email, creditLimit: String(creditLimit), paymentTerms, updatedAt: new Date() })
          .where(and(eq(customers.organizationId, orgId), eq(customers.code, code)));
        result.updated++;
      } else {
        await db.insert(customers).values({ organizationId: orgId, code, nameAr, phone, email, creditLimit: String(creditLimit), paymentTerms });
        result.inserted++;
      }
    } catch (e: unknown) {
      result.errors.push({ row: rowNum, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
    }
  }

  return result;
}

export async function importItemsCSV(csvText: string): Promise<ImportResult | { error: string }> {
  const auth = await authorize("inventory.create");
  if ("error" in auth) return auth;
  const { orgId } = auth;

  const rows = parseCSV(csvText);
  if (rows.length === 0) return { inserted: 0, updated: 0, errors: [], total: 0 };

  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
  const dataRows = header.includes("code") || header.includes("الكود") ? rows.slice(1) : rows;

  const col = (row: string[], names: string[]) => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx !== -1) return row[idx] ?? "";
    }
    return "";
  };

  const result: ImportResult = { inserted: 0, updated: 0, errors: [], total: dataRows.length };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;
    const code = col(row, ["code", "الكود", "كود"]).trim();
    const nameAr = col(row, ["namear", "name_ar", "الاسم", "اسم"]).trim();
    if (!code) { result.errors.push({ row: rowNum, message: "الكود مطلوب" }); continue; }
    if (!nameAr) { result.errors.push({ row: rowNum, message: "الاسم مطلوب" }); continue; }

    const nameEn   = col(row, ["nameen", "name_en", "اسم_انجليزي"]).trim() || null;
    const sellPrice = parseFloat(col(row, ["sellprice", "sell_price", "سعرالبيع"])) || 0;
    const minStock  = parseFloat(col(row, ["minstock", "min_stock", "حدأدنى"])) || 0;
    const desc      = col(row, ["description", "وصف", "الوصف"]).trim() || null;
    const activeStr = col(row, ["isactive", "is_active", "نشط"]).trim().toLowerCase();
    const isActive  = activeStr === "" ? true : !["0", "false", "no", "لا"].includes(activeStr);

    try {
      const existing = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.organizationId, orgId), eq(items.code, code))).limit(1);

      if (existing.length > 0) {
        await db.update(items).set({ nameAr, nameEn, sellPrice: String(sellPrice), minStock: String(minStock), description: desc, isActive, updatedAt: new Date() })
          .where(and(eq(items.organizationId, orgId), eq(items.code, code)));
        result.updated++;
      } else {
        await db.insert(items).values({ organizationId: orgId, code, nameAr, nameEn, sellPrice: String(sellPrice), minStock: String(minStock), description: desc, isActive });
        result.inserted++;
      }
    } catch (e: unknown) {
      result.errors.push({ row: rowNum, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
    }
  }

  return result;
}
