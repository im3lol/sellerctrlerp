"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { parseAmazonWorkbook, normalizeCode } from "@/lib/erp/amazon-import";

export type SkuLinkRow = { sku: string; asin: string; productName: string; autoItemId: string | null };
export type SkuLinkPreview =
  | { ok: true; rows: SkuLinkRow[]; items: { id: string; label: string }[]; alreadyLinked: number; totalSkus: number }
  | { ok: false; error: string };

/** Distinct (sku → {asin, productName}) from the report, first occurrence wins. */
async function readSkus(formData: FormData): Promise<{ sku: string; asin: string; productName: string }[] | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ارفع ملف الطلبات أولاً" };
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const lines = parseAmazonWorkbook(buf);
    const map = new Map<string, { sku: string; asin: string; productName: string }>();
    for (const l of lines) {
      if (!l.sku) continue;
      if (!map.has(l.sku)) map.set(l.sku, { sku: l.sku, asin: l.asin, productName: l.productName });
    }
    return [...map.values()];
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" };
  }
}

/** Preview: which report SKUs are still unlinked, with an auto-match suggestion. */
export async function previewAmazonCodeLinkAction(formData: FormData): Promise<SkuLinkPreview> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const skus = await readSkus(formData);
  if ("error" in skus) return { ok: false, error: skus.error };

  // Existing links (normalized) and all active items for options + code auto-match.
  const [codeRows, itemRows] = await Promise.all([
    db.select({ norm: itemCodes.normalizedCode }).from(itemCodes).where(eq(itemCodes.organizationId, auth.orgId)),
    db.select({ id: items.id, code: items.code, nameAr: items.nameAr }).from(items)
      .where(and(eq(items.organizationId, auth.orgId), eq(items.isActive, true))),
  ]);
  const linked = new Set(codeRows.map((r) => r.norm).filter((x): x is string => !!x));
  const itemByCode = new Map<string, string>();
  const options = itemRows.map((it) => {
    itemByCode.set(normalizeCode(it.code), it.id);
    return { id: it.id, label: `${it.code} — ${it.nameAr}` };
  });

  let alreadyLinked = 0;
  const rows: SkuLinkRow[] = [];
  for (const s of skus) {
    const nSku = normalizeCode(s.sku);
    const nAsin = normalizeCode(s.asin);
    if (linked.has(nSku) || (nAsin && linked.has(nAsin))) { alreadyLinked++; continue; }
    rows.push({ ...s, autoItemId: itemByCode.get(nSku) ?? (nAsin ? itemByCode.get(nAsin) ?? null : null) });
  }

  return { ok: true, rows, items: options, alreadyLinked, totalSkus: skus.length };
}

/** Create SKU (+ ASIN) item_codes for each chosen mapping. Idempotent. */
export async function saveAmazonCodeLinksAction(
  links: { sku: string; asin: string; itemId: string }[],
): Promise<{ ok: true; linked: number } | { ok: false; error: string }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const clean = links.filter((l) => l.itemId && l.sku);
  if (clean.length === 0) return { ok: false, error: "لم تحدّد أي ربط" };

  // Only allow items in this org.
  const itemIds = [...new Set(clean.map((l) => l.itemId))];
  const valid = new Set(
    (await db.select({ id: items.id }).from(items)
      .where(and(eq(items.organizationId, auth.orgId), inArray(items.id, itemIds)))).map((r) => r.id),
  );

  const values: { itemId: string; organizationId: string; codeType: string; code: string; normalizedCode: string }[] = [];
  const seen = new Set<string>();
  for (const l of clean) {
    if (!valid.has(l.itemId)) continue;
    const push = (codeType: string, code: string) => {
      const c = code.trim();
      const norm = normalizeCode(c);
      if (!c || !norm) return;
      const key = `${l.itemId}|${codeType}|${c}`;
      if (seen.has(key)) return;
      seen.add(key);
      values.push({ itemId: l.itemId, organizationId: auth.orgId, codeType, code: c, normalizedCode: norm });
    };
    push("SKU", l.sku);
    if (l.asin) push("ASIN", l.asin);
  }
  if (values.length === 0) return { ok: false, error: "لا توجد أكواد صالحة للربط" };

  await db.insert(itemCodes).values(values).onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] });
  return { ok: true, linked: clean.length };
}
