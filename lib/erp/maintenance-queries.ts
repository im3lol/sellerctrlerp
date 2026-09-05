import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixedAssets, maintenancePlans, workOrders, workOrderParts, items, warehouses, employees,
} from "@/db/schema";
import type { MeterType } from "@/lib/erp/maintenance";

/** Everything the maintenance screen needs, shared with the fleet page below it. */
export async function loadMaintenance(orgId: string, onlyVehicles: boolean) {
  const assetRows = await db.select().from(fixedAssets)
    .where(and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.status, "ACTIVE")))
    .orderBy(asc(fixedAssets.code));

  const assets = (onlyVehicles
    ? assetRows.filter((a) => a.meterType === "KM" || a.category === "VEHICLE")
    : assetRows
  ).map((a) => ({
    id: a.id, code: a.code, nameAr: a.nameAr, category: a.category,
    meterType: a.meterType as MeterType,
    currentMeter: a.currentMeter == null ? null : Number(a.currentMeter),
    isDown: a.isDown,
    plateNumber: a.plateNumber, licenseExpiry: a.licenseExpiry, insuranceExpiry: a.insuranceExpiry,
    driverEmployeeId: a.driverEmployeeId,
  }));

  const assetIds = assets.map((a) => a.id);
  if (assetIds.length === 0) {
    return { assets, plans: [], orders: [], items: [], warehouses: [], technicians: [] };
  }

  const [planRows, orderRows, itemRows, whRows, techRows] = await Promise.all([
    db.select().from(maintenancePlans)
      .where(and(eq(maintenancePlans.organizationId, orgId), inArray(maintenancePlans.assetId, assetIds)))
      .orderBy(asc(maintenancePlans.nameAr)),

    db.select({
      o: workOrders,
      assetName: fixedAssets.nameAr,
      assignedName: employees.fullName,
    }).from(workOrders)
      .innerJoin(fixedAssets, eq(fixedAssets.id, workOrders.assetId))
      .leftJoin(employees, eq(employees.id, workOrders.assignedTo))
      .where(and(eq(workOrders.organizationId, orgId), inArray(workOrders.assetId, assetIds)))
      .orderBy(desc(workOrders.reportedAt)).limit(200),

    db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
      .from(items).where(eq(items.organizationId, orgId)).orderBy(asc(items.code)).limit(2000),

    db.select({ id: warehouses.id, nameAr: warehouses.nameAr })
      .from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
      .orderBy(asc(warehouses.nameAr)),

    db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
      .orderBy(asc(employees.fullName)).limit(500),
  ]);

  const orderIds = orderRows.map((r) => r.o.id);
  const partRows = orderIds.length
    ? await db.select({
        p: workOrderParts, itemCode: items.code, itemName: items.nameAr, whName: warehouses.nameAr,
      }).from(workOrderParts)
        .leftJoin(items, eq(items.id, workOrderParts.itemId))
        .leftJoin(warehouses, eq(warehouses.id, workOrderParts.warehouseId))
        .where(and(eq(workOrderParts.organizationId, orgId), inArray(workOrderParts.workOrderId, orderIds)))
    : [];

  return {
    assets,
    plans: planRows.map((p) => ({
      id: p.id, assetId: p.assetId, nameAr: p.nameAr,
      everyDays: p.everyDays, everyMeter: Number(p.everyMeter),
      lastDoneAt: p.lastDoneAt ? new Date(p.lastDoneAt).toISOString() : null,
      lastDoneMeter: p.lastDoneMeter == null ? null : Number(p.lastDoneMeter),
      isActive: p.isActive,
    })),
    orders: orderRows.map((r) => ({
      id: r.o.id, number: r.o.number, assetId: r.o.assetId, assetName: r.assetName,
      planId: r.o.planId,
      type: r.o.type as "PREVENTIVE" | "CORRECTIVE",
      status: r.o.status as "DRAFT" | "IN_PROGRESS" | "DONE" | "CANCELLED",
      reportedAt: new Date(r.o.reportedAt).toISOString().slice(0, 16).replace("T", " "),
      completedAt: r.o.completedAt ? new Date(r.o.completedAt).toISOString() : null,
      description: r.o.description,
      assignedTo: r.o.assignedTo, assignedName: r.assignedName, warehouseId: r.o.warehouseId,
      laborHours: Number(r.o.laborHours), laborRate: Number(r.o.laborRate),
      downtimeHours: Number(r.o.downtimeHours), partsCost: Number(r.o.partsCost),
      parts: partRows.filter((x) => x.p.workOrderId === r.o.id).map((x) => ({
        id: x.p.id, itemId: x.p.itemId, itemLabel: `${x.itemCode ?? "—"} — ${x.itemName ?? ""}`,
        warehouseId: x.p.warehouseId, warehouseLabel: x.whName ?? "—",
        quantity: Number(x.p.quantity), unitCost: Number(x.p.unitCost), issued: !!x.p.movementId,
      })),
    })),
    items: itemRows.map((i) => ({ id: i.id, label: `${i.code} — ${i.nameAr ?? ""}` })),
    warehouses: whRows.map((w) => ({ id: w.id, label: w.nameAr })),
    technicians: techRows.map((t) => ({ id: t.id, label: t.name ?? t.code ?? "—" })),
  };
}
