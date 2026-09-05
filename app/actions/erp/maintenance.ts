"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import {
  fixedAssets, assetMeterReadings, maintenancePlans, workOrders, workOrderParts,
  accounts, employees, items, warehouses,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit, recordAudit } from "@/lib/erp/audit";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";
import { validateReading, workOrderCost } from "@/lib/erp/maintenance";

/**
 * Maintenance. An asset is a `fixed_assets` row — the machine on the floor and the machine
 * in the ledger are the same machine — and a work order is the document that spends parts
 * on it. Parts leave through postStockMovement; nothing here writes a balance.
 */

const MAINT_CODE = "5305";

/**
 * The maintenance-expense GL, created on first use. An org that never repairs anything has
 * no reason to carry the account, and the default chart stays short.
 */
async function ensureMaintenanceAccount(orgId: string): Promise<string> {
  const found = await resolveAccountIds(orgId, [MAINT_CODE]);
  if (found[MAINT_CODE]) return found[MAINT_CODE];
  const [parent] = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.code, "5"))).limit(1);
  const [created] = await db.insert(accounts).values({
    organizationId: orgId, code: MAINT_CODE, nameAr: "مصروفات الصيانة والإصلاح",
    type: "EXPENSE", normalBalance: "DEBIT", parentId: parent?.id ?? null, isLeaf: true,
  }).returning({ id: accounts.id });
  return created.id;
}

// ── the asset's operational side ────────────────────────────────────────

const opsSchema = z.object({
  assetId: z.string().min(1),
  meterType: z.enum(["NONE", "HOURS", "KM"]),
  plateNumber: z.string().trim().max(40).optional().nullable(),
  licenseExpiry: z.string().trim().optional().nullable(),
  insuranceExpiry: z.string().trim().optional().nullable(),
  driverEmployeeId: z.string().trim().optional().nullable(),
});

/** Turn a ledger asset into a maintained one: give it a meter, papers, maybe a driver. */
export async function saveAssetOpsAction(input: z.input<typeof opsSchema>): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = opsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [asset] = await db.select({ id: fixedAssets.id }).from(fixedAssets)
      .where(and(eq(fixedAssets.id, d.assetId), eq(fixedAssets.organizationId, auth.orgId))).limit(1);
    if (!asset) return { error: "الأصل غير موجود" };

    await db.update(fixedAssets).set({
      meterType: d.meterType,
      plateNumber: d.plateNumber?.trim() || null,
      licenseExpiry: d.licenseExpiry || null,
      insuranceExpiry: d.insuranceExpiry || null,
      driverEmployeeId: d.driverEmployeeId || null,
      updatedAt: new Date(),
    }).where(eq(fixedAssets.id, d.assetId));

    revalidatePath("/maintenance");
    revalidatePath("/fleet");
    return { ok: true };
  });
}

const readingSchema = z.object({
  assetId: z.string().min(1),
  value: z.coerce.number(),
  readAt: z.string().optional().nullable(),
  source: z.enum(["MANUAL", "FUEL", "TRIP", "WORK_ORDER"]).default("MANUAL"),
  notes: z.string().trim().max(300).optional().nullable(),
});

/**
 * Record a meter reading. The reading is kept and the asset's current value moves with it,
 * so every usage-based plan reprices itself the moment someone writes the number down.
 */
export async function recordMeterAction(input: z.input<typeof readingSchema>): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = readingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [asset] = await db.select({ id: fixedAssets.id, meter: fixedAssets.currentMeter, meterType: fixedAssets.meterType })
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, d.assetId), eq(fixedAssets.organizationId, auth.orgId))).limit(1);
    if (!asset) return { error: "الأصل غير موجود" };
    if (asset.meterType === "NONE") return { error: "الأصل ده مش متسجّل عليه عدّاد" };

    const previous = asset.meter == null ? null : Number(asset.meter);
    const bad = validateReading(previous, d.value);
    if (bad) return { error: bad };

    await db.insert(assetMeterReadings).values({
      organizationId: auth.orgId, assetId: d.assetId,
      readAt: d.readAt ? new Date(d.readAt) : new Date(),
      value: String(d.value), source: d.source, notes: d.notes?.trim() || null,
      createdBy: auth.userId,
    });
    await db.update(fixedAssets).set({ currentMeter: String(d.value), updatedAt: new Date() })
      .where(eq(fixedAssets.id, d.assetId));

    revalidatePath("/maintenance");
    revalidatePath("/fleet");
    return { ok: true };
  });
}

// ── preventive plans ────────────────────────────────────────────────────

const planSchema = z.object({
  id: z.string().optional(),
  assetId: z.string().min(1, "اختر الأصل"),
  nameAr: z.string().trim().min(1, "اكتب اسم الخطة").max(120),
  everyDays: z.coerce.number().int().min(0).default(0),
  everyMeter: z.coerce.number().min(0).default(0),
  lastDoneAt: z.string().trim().optional().nullable(),
  lastDoneMeter: z.coerce.number().min(0).optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function savePlanAction(input: z.input<typeof planSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.everyDays <= 0 && d.everyMeter <= 0) return { error: "حدّد كل كام يوم أو كل كام وحدة عدّاد — الاتنين صفر يعني الخطة عمرها ما هتستحق" };

  return withOrgScope(auth.orgId, false, async () => {
    const [asset] = await db.select({ id: fixedAssets.id, meterType: fixedAssets.meterType }).from(fixedAssets)
      .where(and(eq(fixedAssets.id, d.assetId), eq(fixedAssets.organizationId, auth.orgId))).limit(1);
    if (!asset) return { error: "الأصل غير موجود" };
    if (d.everyMeter > 0 && asset.meterType === "NONE") return { error: "خطة بالعدّاد على أصل بدون عدّاد — ظبّط نوع العدّاد الأول" };

    const values = {
      assetId: d.assetId, nameAr: d.nameAr,
      everyDays: d.everyDays, everyMeter: String(d.everyMeter),
      lastDoneAt: d.lastDoneAt ? new Date(d.lastDoneAt) : null,
      lastDoneMeter: d.lastDoneMeter == null ? null : String(d.lastDoneMeter),
      isActive: d.isActive, notes: d.notes?.trim() || null,
    };

    if (d.id) {
      const [existing] = await db.select({ id: maintenancePlans.id }).from(maintenancePlans)
        .where(and(eq(maintenancePlans.id, d.id), eq(maintenancePlans.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "الخطة غير موجودة" };
      await db.update(maintenancePlans).set({ ...values, updatedAt: new Date() }).where(eq(maintenancePlans.id, d.id));
      revalidatePath("/maintenance");
      return { ok: true, id: d.id };
    }

    const [row] = await db.insert(maintenancePlans)
      .values({ organizationId: auth.orgId, ...values })
      .returning({ id: maintenancePlans.id });
    revalidatePath("/maintenance");
    return { ok: true, id: row.id };
  });
}

export async function deletePlanAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [used] = await db.select({ id: workOrders.id }).from(workOrders)
      .where(and(eq(workOrders.organizationId, auth.orgId), eq(workOrders.planId, id))).limit(1);
    // Work orders keep pointing at their plan, so a plan with history is stopped, not
    // erased — the history is the reason anyone trusts the plan.
    if (used) {
      await db.update(maintenancePlans).set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(maintenancePlans.id, id), eq(maintenancePlans.organizationId, auth.orgId)));
      revalidatePath("/maintenance");
      return { ok: true };
    }
    const gone = await db.delete(maintenancePlans)
      .where(and(eq(maintenancePlans.id, id), eq(maintenancePlans.organizationId, auth.orgId)))
      .returning({ id: maintenancePlans.id });
    if (gone.length === 0) return { error: "الخطة غير موجودة" };
    revalidatePath("/maintenance");
    return { ok: true };
  });
}

// ── work orders ─────────────────────────────────────────────────────────

const woSchema = z.object({
  assetId: z.string().min(1, "اختر الأصل"),
  planId: z.string().trim().optional().nullable(),
  type: z.enum(["PREVENTIVE", "CORRECTIVE"]).default("CORRECTIVE"),
  description: z.string().trim().min(1, "اكتب المشكلة أو الشغل المطلوب").max(500),
  reportedAt: z.string().optional().nullable(),
  assignedTo: z.string().trim().optional().nullable(),
  warehouseId: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Open a job. Draft until someone actually starts on it. */
export async function createWorkOrderAction(input: z.input<typeof woSchema>): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = woSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [asset] = await db.select({ id: fixedAssets.id, meter: fixedAssets.currentMeter }).from(fixedAssets)
      .where(and(eq(fixedAssets.id, d.assetId), eq(fixedAssets.organizationId, auth.orgId))).limit(1);
    if (!asset) return { error: "الأصل غير موجود" };

    const reportedAt = d.reportedAt ? new Date(d.reportedAt) : new Date();
    const number = await nextDocumentNumber(db, auth.orgId, "WO", reportedAt.getFullYear());

    const [row] = await db.insert(workOrders).values({
      organizationId: auth.orgId, number, assetId: d.assetId,
      planId: d.planId || null, type: d.type, status: "DRAFT",
      reportedAt, description: d.description,
      assignedTo: d.assignedTo || null, warehouseId: d.warehouseId || null,
      meterAtWork: asset.meter, notes: d.notes?.trim() || null, createdBy: auth.userId,
    }).returning({ id: workOrders.id });

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "WORK_ORDER",
      entityId: row.id, entityNumber: number, summary: `أمر شغل ${number} — ${d.description.slice(0, 60)}`,
    });
    revalidatePath("/maintenance");
    return { ok: true, id: row.id, number };
  });
}

const partSchema = z.object({
  workOrderId: z.string().min(1),
  itemId: z.string().min(1, "اختر الصنف"),
  warehouseId: z.string().min(1, "اختر المخزن"),
  quantity: z.coerce.number().positive("الكمية لازم تكون أكبر من صفر"),
  notes: z.string().trim().max(200).optional().nullable(),
});

/** Plan a part onto the job. Nothing leaves the store until the order is completed. */
export async function addWorkOrderPartAction(input: z.input<typeof partSchema>): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = partSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [wo] = await db.select({ id: workOrders.id, status: workOrders.status }).from(workOrders)
      .where(and(eq(workOrders.id, d.workOrderId), eq(workOrders.organizationId, auth.orgId))).limit(1);
    if (!wo) return { error: "أمر الشغل غير موجود" };
    if (wo.status === "DONE" || wo.status === "CANCELLED") return { error: "أمر الشغل مقفول" };

    const [it] = await db.select({ id: items.id }).from(items)
      .where(and(eq(items.id, d.itemId), eq(items.organizationId, auth.orgId))).limit(1);
    if (!it) return { error: "الصنف غير موجود" };
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, d.warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
    if (!wh) return { error: "المخزن غير موجود" };

    await db.insert(workOrderParts).values({
      organizationId: auth.orgId, workOrderId: d.workOrderId, itemId: d.itemId,
      warehouseId: d.warehouseId, quantity: String(d.quantity), notes: d.notes?.trim() || null,
    });
    revalidatePath("/maintenance");
    return { ok: true };
  });
}

export async function removeWorkOrderPartAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [part] = await db.select({ id: workOrderParts.id, movementId: workOrderParts.movementId })
      .from(workOrderParts)
      .where(and(eq(workOrderParts.id, id), eq(workOrderParts.organizationId, auth.orgId))).limit(1);
    if (!part) return { error: "البند غير موجود" };
    // Once the store released it, the part is gone from the shelf — removing the line
    // would hide a real issue.
    if (part.movementId) return { error: "القطعة اتصرفت من المخزن خلاص — مينفعش تتشال من الأمر" };

    await db.delete(workOrderParts).where(eq(workOrderParts.id, id));
    revalidatePath("/maintenance");
    return { ok: true };
  });
}

export async function startWorkOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [wo] = await db.select().from(workOrders)
      .where(and(eq(workOrders.id, id), eq(workOrders.organizationId, auth.orgId))).limit(1);
    if (!wo) return { error: "أمر الشغل غير موجود" };
    if (wo.status !== "DRAFT") return { error: "الأمر بدأ بالفعل" };

    await db.update(workOrders).set({ status: "IN_PROGRESS", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(workOrders.id, id));
    // The machine is on the bench, whatever the ledger thinks of its book value.
    await db.update(fixedAssets).set({ isDown: true, updatedAt: new Date() }).where(eq(fixedAssets.id, wo.assetId));

    revalidatePath("/maintenance");
    revalidatePath("/fleet");
    return { ok: true };
  });
}

const completeSchema = z.object({
  id: z.string().min(1),
  laborHours: z.coerce.number().min(0).default(0),
  laborRate: z.coerce.number().min(0).default(0),
  downtimeHours: z.coerce.number().min(0).default(0),
  meterAtWork: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Finish the job: the parts leave the store, the expense hits the books, and the plan that
 * asked for it is marked done so the next one is scheduled from today.
 *
 * Labour is recorded but never posted — the wage was booked by payroll, and posting it
 * here would charge the company twice for the same hour.
 */
export async function completeWorkOrderAction(input: z.input<typeof completeSchema>): Promise<ActionState & { cost?: number }> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [wo] = await db.select().from(workOrders)
      .where(and(eq(workOrders.id, d.id), eq(workOrders.organizationId, auth.orgId))).limit(1);
    if (!wo) return { error: "أمر الشغل غير موجود" };
    if (wo.status === "DONE") return { error: "الأمر مقفول بالفعل" };
    if (wo.status === "CANCELLED") return { error: "الأمر ملغي" };

    const parts = await db.select().from(workOrderParts)
      .where(and(eq(workOrderParts.organizationId, auth.orgId), eq(workOrderParts.workOrderId, d.id)));

    const inventoryAccount = await resolveAccountIds(auth.orgId, ["1104"]);
    if (parts.length > 0 && !inventoryAccount["1104"]) return { error: "حساب المخزون (١١٠٤) غير موجود" };
    const maintenanceAccountId = parts.length > 0 ? await ensureMaintenanceAccount(auth.orgId) : null;

    const done = new Date();
    let partsCost = 0;

    try {
      await db.transaction(async (tx) => {
        for (const part of parts) {
          if (part.movementId) { partsCost += Number(part.quantity) * Number(part.unitCost); continue; }
          const r = await postStockMovement(tx, {
            orgId: auth.orgId, itemId: part.itemId, warehouseId: part.warehouseId, type: "ADJ",
            quantity: -Number(part.quantity), date: done,
            referenceType: "WORK_ORDER", referenceId: wo.id, reason: `صيانة ${wo.number}`,
          });
          partsCost += r.totalCost;
          await tx.update(workOrderParts).set({
            unitCost: String(Number(part.quantity) > 0 ? r.totalCost / Number(part.quantity) : 0),
            movementId: r.movementId,
          }).where(eq(workOrderParts.id, part.id));
        }

        let journalEntryId: string | null = null;
        if (partsCost > 0.004 && maintenanceAccountId) {
          const rounded = Math.round(partsCost * 100) / 100;
          journalEntryId = await postEntry(tx, {
            orgId: auth.orgId, date: done, sourceType: "WORK_ORDER", sourceId: wo.id,
            description: `قطع غيار أمر شغل ${wo.number}`, journalType: "GENERAL", userId: auth.userId,
            lines: [
              { accountId: maintenanceAccountId, debit: rounded, credit: 0, description: `صيانة ${wo.number}` },
              { accountId: inventoryAccount["1104"], debit: 0, credit: rounded, description: "قطع غيار من المخزن" },
            ],
          });
        }

        await tx.update(workOrders).set({
          status: "DONE", completedAt: done,
          laborHours: String(d.laborHours), laborRate: String(d.laborRate),
          downtimeHours: String(d.downtimeHours),
          meterAtWork: d.meterAtWork == null ? wo.meterAtWork : String(d.meterAtWork),
          partsCost: String(Math.round(partsCost * 100) / 100),
          journalEntryId, notes: d.notes?.trim() || wo.notes, updatedAt: done,
        }).where(eq(workOrders.id, wo.id));

        // The plan restarts from the day the work was actually done, not from the day it
        // fell due — otherwise a service done late stays permanently late.
        if (wo.planId) {
          await tx.update(maintenancePlans).set({
            lastDoneAt: done,
            lastDoneMeter: d.meterAtWork == null ? wo.meterAtWork : String(d.meterAtWork),
            updatedAt: done,
          }).where(eq(maintenancePlans.id, wo.planId));
        }

        await tx.update(fixedAssets).set({ isDown: false, updatedAt: done }).where(eq(fixedAssets.id, wo.assetId));

        if (d.meterAtWork != null) {
          await tx.insert(assetMeterReadings).values({
            organizationId: auth.orgId, assetId: wo.assetId, readAt: done,
            value: String(d.meterAtWork), source: "WORK_ORDER", notes: `أمر شغل ${wo.number}`,
            createdBy: auth.userId,
          });
          await tx.update(fixedAssets).set({ currentMeter: String(d.meterAtWork) }).where(eq(fixedAssets.id, wo.assetId));
        }

        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "WORK_ORDER",
          entityId: wo.id, entityNumber: wo.number,
          summary: `إقفال أمر شغل ${wo.number} — قطع ${Math.round(partsCost * 100) / 100}`,
        });
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر إقفال أمر الشغل" };
    }

    revalidatePath("/maintenance");
    revalidatePath("/fleet");
    const cost = workOrderCost({
      parts: parts.map((p) => ({ quantity: Number(p.quantity), unitCost: 0 })),
      laborHours: d.laborHours, laborRate: d.laborRate,
    });
    return { ok: true, cost: Math.round((partsCost + cost.labor) * 100) / 100 };
  });
}

export async function cancelWorkOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [wo] = await db.select({ id: workOrders.id, status: workOrders.status, assetId: workOrders.assetId })
      .from(workOrders)
      .where(and(eq(workOrders.id, id), eq(workOrders.organizationId, auth.orgId))).limit(1);
    if (!wo) return { error: "أمر الشغل غير موجود" };
    if (wo.status === "DONE") return { error: "الأمر مقفول — القطع اتصرفت والقيد اتعمل" };

    await db.update(workOrders).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(workOrders.id, id));
    const [other] = await db.select({ id: workOrders.id }).from(workOrders)
      .where(and(
        eq(workOrders.organizationId, auth.orgId),
        eq(workOrders.assetId, wo.assetId),
        eq(workOrders.status, "IN_PROGRESS"),
      )).limit(1);
    if (!other) await db.update(fixedAssets).set({ isDown: false }).where(eq(fixedAssets.id, wo.assetId));

    revalidatePath("/maintenance");
    return { ok: true };
  });
}

export type MeterHistoryRow = { id: string; at: string; value: number; source: string; notes: string | null };

/** The readings behind an asset's current meter. */
export async function listMeterHistoryAction(assetId: string): Promise<ActionState & { rows?: MeterHistoryRow[] }> {
  const auth = await authorizeErp("maintenance.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(assetMeterReadings)
      .where(and(eq(assetMeterReadings.organizationId, auth.orgId), eq(assetMeterReadings.assetId, assetId)))
      .orderBy(desc(assetMeterReadings.readAt)).limit(200);
    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id, at: new Date(r.readAt).toISOString().slice(0, 16).replace("T", " "),
        value: Number(r.value), source: r.source, notes: r.notes,
      })),
    };
  });
}

/** Maintenance cost per asset over a window — the number that retires a machine. */
export async function assetCostSummaryAction(from: string, to: string): Promise<
  ActionState & { rows?: { assetId: string; assetName: string; orders: number; parts: number; labor: number; downtime: number }[] }
> {
  const auth = await authorizeErp("maintenance.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        assetId: workOrders.assetId,
        assetName: fixedAssets.nameAr,
        orders: sql<number>`count(*)::int`,
        parts: sql<string>`coalesce(sum(${workOrders.partsCost}), 0)`,
        labor: sql<string>`coalesce(sum(${workOrders.laborHours} * ${workOrders.laborRate}), 0)`,
        downtime: sql<string>`coalesce(sum(${workOrders.downtimeHours}), 0)`,
      })
      .from(workOrders)
      .innerJoin(fixedAssets, eq(fixedAssets.id, workOrders.assetId))
      .where(and(
        eq(workOrders.organizationId, auth.orgId),
        eq(workOrders.status, "DONE"),
        sql`${workOrders.completedAt} >= ${new Date(from)}`,
        sql`${workOrders.completedAt} < ${new Date(`${to}T23:59:59.999Z`)}`,
      ))
      .groupBy(workOrders.assetId, fixedAssets.nameAr)
      .orderBy(desc(sql`coalesce(sum(${workOrders.partsCost}), 0)`));

    return {
      ok: true,
      rows: rows.map((r) => ({
        assetId: r.assetId, assetName: r.assetName, orders: Number(r.orders),
        parts: Number(r.parts), labor: Number(r.labor), downtime: Number(r.downtime),
      })),
    };
  });
}

/** Employees who can be assigned work, for the pickers. */
export async function listTechniciansAction(): Promise<ActionState & { rows?: { id: string; label: string }[] }> {
  const auth = await authorizeErp("maintenance.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.organizationId, auth.orgId), eq(employees.isActive, true)))
      .orderBy(asc(employees.fullName)).limit(500);
    return { ok: true, rows: rows.map((r) => ({ id: r.id, label: r.name ?? r.code ?? "—" })) };
  });
}

/** Assets that have work orders open right now, for the dashboard badge. */
export async function openWorkOrderCountAction(): Promise<ActionState & { open?: number; assets?: string[] }> {
  const auth = await authorizeErp("maintenance.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({ assetId: workOrders.assetId }).from(workOrders)
      .where(and(
        eq(workOrders.organizationId, auth.orgId),
        inArray(workOrders.status, ["DRAFT", "IN_PROGRESS"]),
      ));
    return { ok: true, open: rows.length, assets: [...new Set(rows.map((r) => r.assetId))] };
  });
}
