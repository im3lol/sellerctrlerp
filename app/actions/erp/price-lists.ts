"use server";

import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { priceLists, priceListItems, customers, items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { validatePriceRows, priceForLine, type PriceRow } from "@/lib/erp/price-list";

const rowSchema = z.object({
  itemId: z.string().min(1),
  price: z.coerce.number().min(0),
  minQuantity: z.coerce.number().min(0).default(0),
});

const listSchema = z.object({
  code: z.string().trim().min(1, "الكود مطلوب").max(32),
  nameAr: z.string().trim().min(1, "الاسم مطلوب").max(120),
  isDefault: z.boolean().default(false),
  validFrom: z.string().optional().nullable(),
  validTo: z.string().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  rows: z.array(rowSchema).max(2000, "قائمة أسعار أكبر من اللازم — قسّمها"),
});

const asDate = (v?: string | null) => (v ? new Date(v) : null);

/** Create or replace a price list together with its rows. */
export async function savePriceListAction(input: z.input<typeof listSchema> & { id?: string }): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const rowError = validatePriceRows(d.rows);
  if (rowError) return { error: rowError };

  const from = asDate(d.validFrom), to = asDate(d.validTo);
  if (from && to && to < from) return { error: "تاريخ النهاية قبل البداية" };

  return withOrgScope(auth.orgId, false, async () => {
    // Every item must belong to this org — the ids come from the client.
    if (d.rows.length) {
      const ids = [...new Set(d.rows.map((r) => r.itemId))];
      const found = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.organizationId, auth.orgId), inArray(items.id, ids)));
      if (found.length !== ids.length) return { error: "صنف غير معروف في القائمة" };
    }

    try {
      const id = await db.transaction(async (tx) => {
        // One default per org, so the fallback is never ambiguous.
        if (d.isDefault) {
          await tx.update(priceLists).set({ isDefault: false })
            .where(eq(priceLists.organizationId, auth.orgId));
        }

        const values = {
          organizationId: auth.orgId, code: d.code, nameAr: d.nameAr, isDefault: d.isDefault,
          validFrom: from, validTo: to, notes: d.notes?.trim() || null, isActive: d.isActive,
          updatedAt: new Date(),
        };

        let listId = input.id ?? "";
        if (listId) {
          const done = await tx.update(priceLists).set(values)
            .where(and(eq(priceLists.id, listId), eq(priceLists.organizationId, auth.orgId)))
            .returning({ id: priceLists.id });
          if (!done.length) throw new Error("القائمة غير موجودة");
          await tx.delete(priceListItems)
            .where(and(eq(priceListItems.priceListId, listId), eq(priceListItems.organizationId, auth.orgId)));
        } else {
          const [created] = await tx.insert(priceLists).values(values).returning({ id: priceLists.id });
          listId = created.id;
        }

        if (d.rows.length) {
          await tx.insert(priceListItems).values(d.rows.map((r) => ({
            organizationId: auth.orgId, priceListId: listId, itemId: r.itemId,
            price: String(r.price), minQuantity: String(r.minQuantity),
          })));
        }

        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: input.id ? "UPDATE" : "CREATE",
          entityType: "PRICE_LIST", entityId: listId, entityNumber: d.code,
          summary: `${input.id ? "تعديل" : "إنشاء"} قائمة أسعار ${d.nameAr} (${d.rows.length} صنف)`,
        });
        return listId;
      });

      revalidatePath("/sales/price-lists");
      return { ok: true, id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الحفظ";
      return { error: /duplicate key/i.test(msg) ? "الكود مستخدم بالفعل" : msg };
    }
  });
}

/** Delete a list. Customers pointing at it fall back to the default. */
export async function deletePriceListAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [list] = await db.select({ nameAr: priceLists.nameAr, code: priceLists.code }).from(priceLists)
      .where(and(eq(priceLists.id, id), eq(priceLists.organizationId, auth.orgId))).limit(1);
    if (!list) return { error: "القائمة غير موجودة" };

    await db.transaction(async (tx) => {
      // Unlink first: a customer left pointing at a deleted list would price at nothing.
      await tx.update(customers).set({ priceListId: null })
        .where(and(eq(customers.organizationId, auth.orgId), eq(customers.priceListId, id)));
      await tx.delete(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.organizationId, auth.orgId)));
    });
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "PRICE_LIST",
      entityId: id, entityNumber: list.code, summary: `حذف قائمة أسعار ${list.nameAr}`,
    });
    revalidatePath("/sales/price-lists");
    return { ok: true };
  });
}

/** Put a customer on a list (or back on the org default with null). */
export async function setCustomerPriceListAction(customerId: string, priceListId: string | null): Promise<ActionState> {
  const auth = await authorizeErp("sales.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    if (priceListId) {
      const [list] = await db.select({ id: priceLists.id }).from(priceLists)
        .where(and(eq(priceLists.id, priceListId), eq(priceLists.organizationId, auth.orgId))).limit(1);
      if (!list) return { error: "القائمة غير موجودة" };
    }
    const done = await db.update(customers).set({ priceListId, updatedAt: new Date() })
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId)))
      .returning({ id: customers.id });
    if (!done.length) return { error: "العميل غير موجود" };
    revalidatePath("/sales/customers");
    return { ok: true };
  });
}

/**
 * The prices a sales form should start from, for one customer and a set of items.
 * Returns only what the customer's list actually covers — the caller keeps the item's
 * own sellPrice for everything else.
 */
export async function getCustomerPricesAction(
  customerId: string,
  lines: { itemId: string; quantity: number }[],
): Promise<ActionState & { prices?: Record<string, number> }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;
  if (!customerId || !lines.length) return { ok: true, prices: {} };

  return withOrgScope(auth.orgId, false, async () => {
    const [cust] = await db.select({ priceListId: customers.priceListId }).from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود" };

    const [list] = await db.select({
      id: priceLists.id, validFrom: priceLists.validFrom, validTo: priceLists.validTo, isActive: priceLists.isActive,
    }).from(priceLists)
      .where(and(
        eq(priceLists.organizationId, auth.orgId),
        cust.priceListId ? eq(priceLists.id, cust.priceListId) : eq(priceLists.isDefault, true),
      )).limit(1);
    if (!list) return { ok: true, prices: {} };

    const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
    const rows: PriceRow[] = (await db.select({
      itemId: priceListItems.itemId, price: priceListItems.price, minQuantity: priceListItems.minQuantity,
    }).from(priceListItems)
      .where(and(eq(priceListItems.priceListId, list.id), inArray(priceListItems.itemId, itemIds)))
      .orderBy(asc(priceListItems.minQuantity)))
      .map((r) => ({ itemId: r.itemId, price: Number(r.price), minQuantity: Number(r.minQuantity) }));

    const prices: Record<string, number> = {};
    for (const l of lines) {
      // sellPrice 0 + source check: only a real list hit is returned, so the form keeps
      // its own price for anything the list doesn't cover.
      const r = priceForLine({ rows, list, itemId: l.itemId, quantity: l.quantity, sellPrice: 0 });
      if (r.source === "list") prices[l.itemId] = r.price;
    }
    return { ok: true, prices };
  });
}
