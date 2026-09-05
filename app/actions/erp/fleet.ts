"use server";

import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { fixedAssets, assetMeterReadings, fuelLogs, trips, workOrders } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { validateReading } from "@/lib/erp/maintenance";
import { consumption, fuelOutliers, costPerKm, validateTrip, type FuelLog } from "@/lib/erp/fleet";

/**
 * The fleet face. A vehicle is a `fixed_assets` row with an odometer, so this file adds
 * only what a truck has that a lathe does not: fuel and trips. Everything about work
 * orders, plans and meters is the maintenance engine, unchanged.
 *
 * ponytail: fuel is recorded as an operating fact, not posted. The pump receipt reaches
 * the books as an ordinary expense or purchase invoice like every other bill — booking it
 * here too would charge the company twice for the same tank.
 */

const fuelSchema = z.object({
  assetId: z.string().min(1, "اختر السيارة"),
  filledAt: z.string().min(1, "التاريخ مطلوب"),
  liters: z.coerce.number().positive("اللترات لازم تكون أكبر من صفر"),
  cost: z.coerce.number().min(0),
  meterValue: z.coerce.number().min(0).optional().nullable(),
  driverEmployeeId: z.string().trim().optional().nullable(),
  station: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/**
 * Log a tank. The odometer at the pump is the whole point — without it the litres say
 * nothing about consumption, so the reading is pushed onto the asset as well.
 */
export async function logFuelAction(input: z.input<typeof fuelSchema>): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = fuelSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [asset] = await db.select({ id: fixedAssets.id, meter: fixedAssets.currentMeter })
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, d.assetId), eq(fixedAssets.organizationId, auth.orgId))).limit(1);
    if (!asset) return { error: "السيارة غير موجودة" };

    const filledAt = new Date(d.filledAt);
    if (d.meterValue != null) {
      const bad = validateReading(asset.meter == null ? null : Number(asset.meter), d.meterValue);
      if (bad) return { error: bad };
    }

    await db.insert(fuelLogs).values({
      organizationId: auth.orgId, assetId: d.assetId, filledAt,
      liters: String(d.liters), cost: String(d.cost),
      meterValue: d.meterValue == null ? null : String(d.meterValue),
      driverEmployeeId: d.driverEmployeeId || null,
      station: d.station?.trim() || null, notes: d.notes?.trim() || null,
      createdBy: auth.userId,
    });

    if (d.meterValue != null) {
      await db.insert(assetMeterReadings).values({
        organizationId: auth.orgId, assetId: d.assetId, readAt: filledAt,
        value: String(d.meterValue), source: "FUEL", notes: d.station?.trim() || null,
        createdBy: auth.userId,
      });
      await db.update(fixedAssets).set({ currentMeter: String(d.meterValue), updatedAt: new Date() })
        .where(eq(fixedAssets.id, d.assetId));
    }

    revalidatePath("/fleet");
    return { ok: true };
  });
}

export async function deleteFuelLogAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const gone = await db.delete(fuelLogs)
      .where(and(eq(fuelLogs.id, id), eq(fuelLogs.organizationId, auth.orgId)))
      .returning({ id: fuelLogs.id });
    if (gone.length === 0) return { error: "السجل غير موجود" };
    // The reading it left behind stays: it was a real observation of the odometer, and
    // deleting it would let the meter appear to go backwards.
    revalidatePath("/fleet");
    return { ok: true };
  });
}

const tripSchema = z.object({
  id: z.string().optional(),
  assetId: z.string().min(1, "اختر السيارة"),
  driverEmployeeId: z.string().trim().optional().nullable(),
  startedAt: z.string().min(1, "وقت البداية مطلوب"),
  endedAt: z.string().trim().optional().nullable(),
  startMeter: z.coerce.number().min(0),
  endMeter: z.coerce.number().min(0).optional().nullable(),
  purpose: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/** Start or close a trip. Closing it moves the vehicle's odometer to where it came back. */
export async function saveTripAction(input: z.input<typeof tripSchema>): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  const parsed = tripSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const bad = validateTrip(d.startMeter, d.endMeter ?? null);
  if (bad) return { error: bad };

  return withOrgScope(auth.orgId, false, async () => {
    const [asset] = await db.select({ id: fixedAssets.id, meter: fixedAssets.currentMeter })
      .from(fixedAssets)
      .where(and(eq(fixedAssets.id, d.assetId), eq(fixedAssets.organizationId, auth.orgId))).limit(1);
    if (!asset) return { error: "السيارة غير موجودة" };

    const values = {
      assetId: d.assetId, driverEmployeeId: d.driverEmployeeId || null,
      startedAt: new Date(d.startedAt),
      endedAt: d.endedAt ? new Date(d.endedAt) : null,
      startMeter: String(d.startMeter),
      endMeter: d.endMeter == null ? null : String(d.endMeter),
      purpose: d.purpose?.trim() || null, notes: d.notes?.trim() || null,
    };

    let id = d.id;
    if (id) {
      const [existing] = await db.select({ id: trips.id }).from(trips)
        .where(and(eq(trips.id, id), eq(trips.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "الرحلة غير موجودة" };
      await db.update(trips).set({ ...values, updatedAt: new Date() }).where(eq(trips.id, id));
    } else {
      const [row] = await db.insert(trips)
        .values({ organizationId: auth.orgId, createdBy: auth.userId, ...values })
        .returning({ id: trips.id });
      id = row.id;
    }

    if (d.endMeter != null) {
      const previous = asset.meter == null ? null : Number(asset.meter);
      // A trip closed out of order must not drag the odometer backwards.
      if (previous == null || d.endMeter > previous) {
        await db.insert(assetMeterReadings).values({
          organizationId: auth.orgId, assetId: d.assetId, readAt: values.endedAt ?? new Date(),
          value: String(d.endMeter), source: "TRIP", notes: values.purpose,
          createdBy: auth.userId,
        });
        await db.update(fixedAssets).set({ currentMeter: String(d.endMeter), updatedAt: new Date() })
          .where(eq(fixedAssets.id, d.assetId));
      }
    }

    revalidatePath("/fleet");
    return { ok: true, id };
  });
}

export async function deleteTripAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("maintenance.manage");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const gone = await db.delete(trips)
      .where(and(eq(trips.id, id), eq(trips.organizationId, auth.orgId)))
      .returning({ id: trips.id });
    if (gone.length === 0) return { error: "الرحلة غير موجودة" };
    revalidatePath("/fleet");
    return { ok: true };
  });
}

export type VehicleEconomy = {
  assetId: string;
  assetName: string;
  plateNumber: string | null;
  distance: number;
  liters: number;
  fuelCost: number;
  maintenanceCost: number;
  depreciation: number;
  per100: number | null;
  perKm: number;
  outliers: number;
};

/**
 * What each vehicle cost per kilometre over a window, and how many fills burned well past
 * its own normal. Depreciation is included because leaving it out is how a fleet talks
 * itself into keeping an old truck.
 */
export async function fleetEconomyAction(from: string, to: string): Promise<ActionState & { rows?: VehicleEconomy[] }> {
  const auth = await authorizeErp("maintenance.view");
  if ("error" in auth) return auth;

  const start = new Date(from);
  const end = new Date(`${to}T23:59:59.999Z`);

  return withOrgScope(auth.orgId, false, async () => {
    const vehicles = await db.select({
      id: fixedAssets.id, nameAr: fixedAssets.nameAr, plateNumber: fixedAssets.plateNumber,
      purchaseCost: fixedAssets.purchaseCost, salvage: fixedAssets.salvageValue, life: fixedAssets.usefulLifeYears,
    }).from(fixedAssets)
      .where(and(eq(fixedAssets.organizationId, auth.orgId), eq(fixedAssets.meterType, "KM")));
    if (vehicles.length === 0) return { ok: true, rows: [] };

    const ids = vehicles.map((v) => v.id);
    const [fuel, maint] = await Promise.all([
      db.select().from(fuelLogs).where(and(
        eq(fuelLogs.organizationId, auth.orgId),
        inArray(fuelLogs.assetId, ids),
        sql`${fuelLogs.filledAt} >= ${start}`,
        sql`${fuelLogs.filledAt} <= ${end}`,
      )).orderBy(desc(fuelLogs.filledAt)),

      db.select({
        assetId: workOrders.assetId,
        parts: sql<string>`coalesce(sum(${workOrders.partsCost}), 0)`,
        labor: sql<string>`coalesce(sum(${workOrders.laborHours} * ${workOrders.laborRate}), 0)`,
      }).from(workOrders).where(and(
        eq(workOrders.organizationId, auth.orgId),
        eq(workOrders.status, "DONE"),
        inArray(workOrders.assetId, ids),
        sql`${workOrders.completedAt} >= ${start}`,
        sql`${workOrders.completedAt} <= ${end}`,
      )).groupBy(workOrders.assetId),
    ]);

    const maintBy = new Map(maint.map((m) => [m.assetId, Number(m.parts) + Number(m.labor)]));
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));

    const rows: VehicleEconomy[] = vehicles.map((v) => {
      const logs: FuelLog[] = fuel.filter((f) => f.assetId === v.id).map((f) => ({
        id: f.id, at: new Date(f.filledAt).toISOString().slice(0, 10),
        liters: Number(f.liters), cost: Number(f.cost),
        meterValue: f.meterValue == null ? null : Number(f.meterValue),
      }));
      const cons = consumption(logs);
      const distance = cons.reduce((s, c) => s + c.distance, 0);
      const liters = logs.reduce((s, l) => s + l.liters, 0);
      const fuelCost = logs.reduce((s, l) => s + l.cost, 0);
      const maintenanceCost = maintBy.get(v.id) ?? 0;
      // Straight-line depreciation for the window, from the same numbers the ledger uses.
      const yearly = Math.max(0, (Number(v.purchaseCost) - Number(v.salvage)) / Math.max(1, v.life));
      const depreciation = Math.round((yearly / 365) * days * 100) / 100;
      const c = costPerKm({ distance, fuelCost, maintenanceCost, depreciation });

      return {
        assetId: v.id, assetName: v.nameAr, plateNumber: v.plateNumber,
        distance, liters: Math.round(liters * 100) / 100,
        fuelCost: c.breakdown.fuel, maintenanceCost: c.breakdown.maintenance, depreciation,
        per100: distance > 0 ? Math.round((cons.reduce((s, x) => s + x.liters, 0) / distance) * 100 * 100) / 100 : null,
        perKm: c.perKm,
        outliers: fuelOutliers(cons).length,
      };
    });

    return { ok: true, rows: rows.sort((a, b) => b.perKm - a.perKm) };
  });
}
