"use server";

import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { promotions, loyaltyEntries, organizations, customers, items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import type { Promotion } from "@/lib/erp/promotions";
import { pointsBalance } from "@/lib/erp/loyalty";

/**
 * Promotions and loyalty settings. The arithmetic lives in lib/erp/promotions.ts and
 * lib/erp/loyalty.ts; this file only stores the rules and reads the ledger.
 */

const schema = z.object({
  nameAr: z.string().trim().min(1, "اكتب اسم العرض").max(120),
  type: z.enum(["PERCENT", "AMOUNT", "BUY_X_GET_Y"]),
  value: z.coerce.number().min(0).default(0),
  itemId: z.string().trim().min(1).optional().nullable(),
  minQuantity: z.coerce.number().min(0).default(0),
  minAmount: z.coerce.number().min(0).default(0),
  buyQty: z.coerce.number().int().min(0).default(0),
  getQty: z.coerce.number().int().min(0).default(0),
  startsAt: z.string().trim().optional().nullable(),
  endsAt: z.string().trim().optional().nullable(),
  priority: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** The shapes that make no sense, refused before they can quietly discount nothing. */
function shapeError(d: z.output<typeof schema>): string | null {
  if (d.type === "BUY_X_GET_Y") {
    if (!d.itemId) return "عرض «اشترِ واحصل» لازم يكون على صنف محدّد";
    if (d.buyQty < 1 || d.getQty < 1) return "حدّد تشتري كام وتاخد كام";
  } else if (d.value <= 0) {
    return "قيمة العرض لازم تكون أكبر من صفر";
  }
  if (d.type === "PERCENT" && d.value > 100) return "النسبة مينفعش تعدّي ١٠٠٪";
  if (!d.itemId && d.type === "BUY_X_GET_Y") return "العرض ده محتاج صنف";
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return "تاريخ النهاية قبل البداية";
  return null;
}

export async function savePromotionAction(
  input: z.input<typeof schema> & { id?: string },
): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const bad = shapeError(d);
  if (bad) return { error: bad };

  return withOrgScope(auth.orgId, false, async () => {
    if (d.itemId) {
      const [it] = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.id, d.itemId), eq(items.organizationId, auth.orgId))).limit(1);
      if (!it) return { error: "الصنف غير موجود" };
    }

    const values = {
      nameAr: d.nameAr, type: d.type, value: String(d.value),
      itemId: d.itemId || null,
      minQuantity: String(d.minQuantity), minAmount: String(d.minAmount),
      buyQty: d.buyQty, getQty: d.getQty,
      startsAt: d.startsAt || null, endsAt: d.endsAt || null,
      priority: d.priority, isActive: d.isActive, notes: d.notes?.trim() || null,
    };

    if (input.id) {
      const [existing] = await db.select({ id: promotions.id, code: promotions.code }).from(promotions)
        .where(and(eq(promotions.id, input.id), eq(promotions.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "العرض غير موجود" };
      await db.update(promotions).set({ ...values, updatedAt: new Date() }).where(eq(promotions.id, input.id));
      await tryRecordAudit({
        orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "PROMOTION",
        entityId: input.id, entityNumber: existing.code, summary: `تعديل عرض ${d.nameAr}`,
      });
      revalidatePath("/sales/promotions");
      return { ok: true, id: input.id };
    }

    const code = await nextDocumentNumber(db, auth.orgId, "PRM", new Date().getFullYear());
    const [row] = await db.insert(promotions)
      .values({ organizationId: auth.orgId, code, ...values })
      .returning({ id: promotions.id });

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PROMOTION",
      entityId: row.id, entityNumber: code, summary: `عرض جديد ${d.nameAr}`,
    });
    revalidatePath("/sales/promotions");
    return { ok: true, id: row.id };
  });
}

export async function deletePromotionAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    // A promotion leaves no trail of its own — the discount it caused is already on the
    // invoices it touched, and those do not change.
    const deleted = await db.delete(promotions)
      .where(and(eq(promotions.id, id), eq(promotions.organizationId, auth.orgId)))
      .returning({ code: promotions.code });
    if (deleted.length === 0) return { error: "العرض غير موجود" };
    revalidatePath("/sales/promotions");
    return { ok: true };
  });
}

const settingsSchema = z.object({
  earnRate: z.coerce.number().min(0).max(100),
  redeemRate: z.coerce.number().min(0).max(100),
  minRedeem: z.coerce.number().int().min(0),
});

export async function saveLoyaltySettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    await db.update(organizations).set({
      loyaltyEarnRate: String(d.earnRate),
      loyaltyRedeemRate: String(d.redeemRate),
      loyaltyMinRedeem: d.minRedeem,
      updatedAt: new Date(),
    }).where(eq(organizations.id, auth.orgId));

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "SETTINGS",
      entityId: auth.orgId, entityNumber: "loyalty",
      summary: `نقط الولاء: ${d.earnRate} نقطة للجنيه، النقطة بـ ${d.redeemRate}`,
    });
    revalidatePath("/sales/promotions");
    return { ok: true };
  });
}

/** A customer's points balance, straight out of the ledger. */
export async function getLoyaltyBalanceAction(customerId: string): Promise<ActionState & { points?: number }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [row] = await db
      .select({ points: sql<number>`coalesce(sum(${loyaltyEntries.points}), 0)::int` })
      .from(loyaltyEntries)
      .where(and(eq(loyaltyEntries.organizationId, auth.orgId), eq(loyaltyEntries.customerId, customerId)));
    return { ok: true, points: Number(row?.points ?? 0) };
  });
}

export type LoyaltyRow = {
  id: string; customerName: string; points: number; kind: string; amount: number; at: string; notes: string | null;
};

/** The points ledger, newest first — the answer to "where did my points go". */
export async function listLoyaltyEntriesAction(customerId?: string): Promise<ActionState & { rows?: LoyaltyRow[]; balance?: number }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const where = customerId
      ? and(eq(loyaltyEntries.organizationId, auth.orgId), eq(loyaltyEntries.customerId, customerId))
      : eq(loyaltyEntries.organizationId, auth.orgId);

    const rows = await db
      .select({
        id: loyaltyEntries.id, points: loyaltyEntries.points, kind: loyaltyEntries.kind,
        amount: loyaltyEntries.amount, at: loyaltyEntries.createdAt, notes: loyaltyEntries.notes,
        customerName: customers.nameAr,
      })
      .from(loyaltyEntries)
      .innerJoin(customers, eq(customers.id, loyaltyEntries.customerId))
      .where(where)
      .orderBy(asc(loyaltyEntries.createdAt))
      .limit(500);

    return {
      ok: true,
      balance: pointsBalance(rows),
      rows: rows.reverse().map((r) => ({
        id: r.id, customerName: r.customerName, points: r.points, kind: r.kind,
        amount: Number(r.amount), notes: r.notes,
        at: new Date(r.at).toISOString().slice(0, 16).replace("T", " "),
      })),
    };
  });
}

/** Every rule the till needs, in the shape the engine expects. */
export async function listPromotionsAction(activeOnly = false): Promise<ActionState & { rows?: (Promotion & { code: string; isActive: boolean; itemLabel: string | null; notes: string | null })[] }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        id: promotions.id, code: promotions.code, nameAr: promotions.nameAr, type: promotions.type,
        value: promotions.value, itemId: promotions.itemId,
        minQuantity: promotions.minQuantity, minAmount: promotions.minAmount,
        buyQty: promotions.buyQty, getQty: promotions.getQty,
        startsAt: promotions.startsAt, endsAt: promotions.endsAt,
        priority: promotions.priority, isActive: promotions.isActive, notes: promotions.notes,
        itemCode: items.code, itemName: items.nameAr,
      })
      .from(promotions)
      .leftJoin(items, eq(items.id, promotions.itemId))
      .where(activeOnly
        ? and(eq(promotions.organizationId, auth.orgId), eq(promotions.isActive, true))
        : eq(promotions.organizationId, auth.orgId))
      .orderBy(asc(promotions.code));

    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id, code: r.code, nameAr: r.nameAr,
        type: r.type as Promotion["type"], value: Number(r.value), itemId: r.itemId,
        minQuantity: Number(r.minQuantity), minAmount: Number(r.minAmount),
        buyQty: r.buyQty, getQty: r.getQty,
        startsAt: r.startsAt, endsAt: r.endsAt, priority: r.priority,
        isActive: r.isActive, notes: r.notes,
        itemLabel: r.itemCode ? `${r.itemCode} — ${r.itemName}` : null,
      })),
    };
  });
}
