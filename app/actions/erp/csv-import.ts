"use server";

import { withOrgScope } from "@/lib/db-scope";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, items, itemCodes, suppliers } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { normalizeCode } from "@/lib/erp/amazon-import";

// Platform-code columns → item_codes.codeType. One master product carries many codes; the
// order matcher resolves an incoming line by ANY of these, so a single product covers every
// marketplace. Aligned with CHANNEL_CODE_TYPE (ASIN/NOON/SHOPIFY/WOO/JUMIA) + a universal
// barcode (EAN/UPC/GTIN) + the seller's own SKU.
// `unique` = the code identifies exactly one product (seller SKU / FNSKU / partner SKU), so it
// must not repeat across products and is the primary order-match key. Shared codes (ASIN,
// barcode) may map to several products, so a row that only carries a shared code can't be
// matched unambiguously — it needs a unique code too.
const CODE_COLUMNS: { names: string[]; codeType: string; unique: boolean }[] = [
  { names: ["barcode", "الباركود", "باركود", "ean", "upc", "gtin"], codeType: "BARCODE", unique: false },
  { names: ["asin", "amazon_asin", "amazonasin", "أمازون"], codeType: "ASIN", unique: false },
  { names: ["amazon_sku", "amazonsku", "sku_amazon", "sellersku"], codeType: "SKU", unique: true },
  { names: ["fnsku", "fn_sku", "amazon_fnsku"], codeType: "FNSKU", unique: true },
  { names: ["noon_sku", "noonsku", "partner_sku", "partnersku", "psku", "نون"], codeType: "NOON", unique: true },
  { names: ["shopify_sku", "shopifysku", "shopify"], codeType: "SHOPIFY", unique: true },
  { names: ["woo_sku", "woosku", "woocommerce", "woo"], codeType: "WOO", unique: true },
  { names: ["jumia_sku", "jumiasku", "jumia"], codeType: "JUMIA", unique: true },
];

export type ImportResult = {
  inserted: number;
  updated: number;
  errors: { row: number; message: string }[];
  warnings?: { row: number; message: string }[];
  total: number;
};

// Every importer enforces the specific create permission (not just org
// membership) — a viewer must not be able to bulk-insert/overwrite master data.
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
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
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
  });
}

export async function importSuppliersCSV(csvText: string): Promise<ImportResult | { error: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const { orgId } = auth;

    const rows = parseCSV(csvText);
    if (rows.length === 0) return { inserted: 0, updated: 0, errors: [], total: 0 };

    const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, ""));
    const dataRows = header.includes("code") || header.includes("الكود") ? rows.slice(1) : rows;
    const col = (row: string[], names: string[]) => {
      for (const n of names) { const idx = header.indexOf(n); if (idx !== -1) return row[idx] ?? ""; }
      return row[0] ?? "";
    };

    const result: ImportResult = { inserted: 0, updated: 0, errors: [], total: dataRows.length };
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      const code = col(row, ["code", "الكود", "كود"]).trim();
      const nameAr = col(row, ["namear", "name_ar", "الاسم", "اسم"]).trim();
      if (!code) { result.errors.push({ row: rowNum, message: "الكود مطلوب" }); continue; }
      if (!nameAr) { result.errors.push({ row: rowNum, message: "الاسم مطلوب" }); continue; }

      const phone = col(row, ["phone", "هاتف", "الهاتف"]).trim() || null;
      const email = col(row, ["email", "بريد", "البريد"]).trim() || null;
      const address = col(row, ["address", "عنوان", "العنوان"]).trim() || null;
      const paymentTerms = parseInt(col(row, ["paymentterms", "مدةالسداد", "مدة"])) || 30;

      try {
        const existing = await db.select({ id: suppliers.id }).from(suppliers)
          .where(and(eq(suppliers.organizationId, orgId), eq(suppliers.code, code))).limit(1);
        if (existing.length > 0) {
          await db.update(suppliers).set({ nameAr, phone, email, address, paymentTerms, updatedAt: new Date() })
            .where(and(eq(suppliers.organizationId, orgId), eq(suppliers.code, code)));
          result.updated++;
        } else {
          await db.insert(suppliers).values({ organizationId: orgId, code, nameAr, phone, email, address, paymentTerms });
          result.inserted++;
        }
      } catch (e: unknown) {
        result.errors.push({ row: rowNum, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
      }
    }
    return result;
  });
}

export async function importItemsCSV(csvText: string): Promise<ImportResult | { error: string }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
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

    const result: ImportResult = { inserted: 0, updated: 0, errors: [], warnings: [], total: dataRows.length };
    // Tracks each unique platform code → the item that owns it, to catch the same unique code
    // (SKU/FNSKU/partner SKU) accidentally assigned to two different products across rows.
    const seenUnique = new Map<string, string>();

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      const code = col(row, ["code", "الكود", "كود"]).trim();
      const nameAr = col(row, ["namear", "name_ar", "الاسم", "اسم"]).trim();
      if (!code) { result.errors.push({ row: rowNum, message: "الكود مطلوب" }); continue; }
      if (!nameAr) { result.errors.push({ row: rowNum, message: "الاسم مطلوب" }); continue; }

      const sellPrice = parseFloat(col(row, ["sellprice", "sell_price", "سعرالبيع"])) || 0;
      const minStock  = parseFloat(col(row, ["minstock", "min_stock", "حدأدنى"])) || 0;
      const desc      = col(row, ["description", "وصف", "الوصف"]).trim() || null;
      const brand     = col(row, ["brand", "البراند", "الماركة", "العلامة"]).trim() || null;
      const activeStr = col(row, ["isactive", "is_active", "نشط"]).trim().toLowerCase();
      const isActive  = activeStr === "" ? true : !["0", "false", "no", "لا"].includes(activeStr);

      try {
        const existing = await db.select({ id: items.id }).from(items)
          .where(and(eq(items.organizationId, orgId), eq(items.code, code))).limit(1);

        let itemId: string;
        if (existing.length > 0) {
          itemId = existing[0].id;
          await db.update(items).set({ nameAr, sellPrice: String(sellPrice), minStock: String(minStock), description: desc, brand, isActive, updatedAt: new Date() })
            .where(and(eq(items.organizationId, orgId), eq(items.code, code)));
          result.updated++;
        } else {
          const [ins] = await db.insert(items).values({ organizationId: orgId, code, nameAr, sellPrice: String(sellPrice), minStock: String(minStock), description: desc, brand, isActive }).returning({ id: items.id });
          itemId = ins.id;
          result.inserted++;
        }

        // Link the platform codes present on the row → item_codes (idempotent). This is
        // what makes ONE product cover Amazon/Noon/… — the order matcher resolves by any code.
        let hasUnique = false, hasShared = false;
        const codeRows = CODE_COLUMNS.flatMap(({ names, codeType, unique }) => {
          const v = col(row, names).trim();
          const norm = normalizeCode(v);
          if (!v || !norm) return [];
          if (unique) {
            hasUnique = true;
            const key = `${codeType}:${norm}`;
            const owner = seenUnique.get(key);
            if (owner && owner !== itemId) {
              result.errors.push({ row: rowNum, message: `الكود ${codeType} «${v}» مكرّر على منتج آخر — الكود الفريد لازم يخصّ منتجًا واحدًا` });
              return []; // skip the conflicting code; the item itself still imports
            }
            seenUnique.set(key, itemId);
          } else { hasShared = true; }
          return [{ itemId, organizationId: orgId, codeType, code: v, normalizedCode: norm }];
        });
        // A row with only a shared code (ASIN/barcode) and no unique SKU can't be matched
        // unambiguously if that code is on several products — warn (import still proceeds).
        if (hasShared && !hasUnique) {
          result.warnings?.push({ row: rowNum, message: "كود مشترك (ASIN/باركود) بدون كود فريد — قد لا تُطابَق الطلبات؛ أضِف SKU/FNSKU/PSKU" });
        }
        if (codeRows.length) {
          await db.insert(itemCodes).values(codeRows).onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] });
        }
      } catch (e: unknown) {
        result.errors.push({ row: rowNum, message: e instanceof Error ? e.message : "خطأ في الاستيراد" });
      }
    }

    return result;
  });
}
