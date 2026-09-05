import { and, desc, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { fixedAssets, fuelLogs, trips, workOrders, employees } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FleetManager } from "@/components/erp/fleet-manager";
import { MaintenanceManager } from "@/components/erp/maintenance-manager";
import { consumption, costPerKm, fuelOutliers, type FuelLog } from "@/lib/erp/fleet";
import { loadMaintenance } from "@/lib/erp/maintenance-queries";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  return loadErpPage("maintenance.view", async ({ orgId, can }) => {
    const maint = await loadMaintenance(orgId, true);
    const vehicles = maint.assets;

    if (vehicles.length === 0) {
      return (
        <div className="space-y-6">
          <ErpPageHeader icon="Truck" title="الأسطول" subtitle="عربيات وسائقين ووقود — على نفس محرك الصيانة" />
          <p className="text-sm text-muted-foreground">
            مفيش عربيات. سجّل العربية في «الأصول الثابتة» وظبّط نوع العدّاد على «كم» من شاشة الصيانة، وهي هتظهر هنا.
          </p>
        </div>
      );
    }

    const ids = vehicles.map((v) => v.id);
    const [fuelRows, tripRows, maintCost, assetRows] = await Promise.all([
      db.select({
        f: fuelLogs, assetName: fixedAssets.nameAr, driverName: employees.fullName,
      }).from(fuelLogs)
        .innerJoin(fixedAssets, eq(fixedAssets.id, fuelLogs.assetId))
        .leftJoin(employees, eq(employees.id, fuelLogs.driverEmployeeId))
        .where(and(eq(fuelLogs.organizationId, orgId), inArray(fuelLogs.assetId, ids)))
        .orderBy(desc(fuelLogs.filledAt)).limit(500),

      db.select({
        t: trips, assetName: fixedAssets.nameAr, driverName: employees.fullName,
      }).from(trips)
        .innerJoin(fixedAssets, eq(fixedAssets.id, trips.assetId))
        .leftJoin(employees, eq(employees.id, trips.driverEmployeeId))
        .where(and(eq(trips.organizationId, orgId), inArray(trips.assetId, ids)))
        .orderBy(desc(trips.startedAt)).limit(300),

      db.select({ assetId: workOrders.assetId, parts: workOrders.partsCost, hours: workOrders.laborHours, rate: workOrders.laborRate })
        .from(workOrders)
        .where(and(
          eq(workOrders.organizationId, orgId),
          eq(workOrders.status, "DONE"),
          inArray(workOrders.assetId, ids),
        )),

      db.select({ id: fixedAssets.id, purchaseCost: fixedAssets.purchaseCost, salvage: fixedAssets.salvageValue, life: fixedAssets.usefulLifeYears, purchaseDate: fixedAssets.purchaseDate })
        .from(fixedAssets).where(inArray(fixedAssets.id, ids)),
    ]);

    const fuel = fuelRows.map((r) => ({
      id: r.f.id, assetId: r.f.assetId, assetName: r.assetName,
      at: new Date(r.f.filledAt).toISOString().slice(0, 10),
      liters: Number(r.f.liters), cost: Number(r.f.cost),
      meterValue: r.f.meterValue == null ? null : Number(r.f.meterValue),
      station: r.f.station, driverName: r.driverName,
    }));

    const maintBy = new Map<string, number>();
    for (const m of maintCost) {
      maintBy.set(m.assetId, (maintBy.get(m.assetId) ?? 0) + Number(m.parts) + Number(m.hours) * Number(m.rate));
    }
    const depBy = new Map<string, number>();
    for (const a of assetRows) {
      const years = Math.max(0, (Date.now() - new Date(a.purchaseDate).getTime()) / (365 * 86_400_000));
      const yearly = Math.max(0, (Number(a.purchaseCost) - Number(a.salvage)) / Math.max(1, a.life));
      // Depreciation charged so far, capped at the depreciable amount — the same figure
      // the ledger reaches, so the two screens never disagree.
      depBy.set(a.id, Math.round(Math.min(yearly * years, yearly * a.life) * 100) / 100);
    }

    // Lifetime economy: everything the vehicle has cost against everything it has driven.
    const economy = vehicles.map((v) => {
      const logs: FuelLog[] = fuel.filter((f) => f.assetId === v.id);
      const cons = consumption(logs);
      const distance = cons.reduce((s, c) => s + c.distance, 0);
      const fuelCost = logs.reduce((s, l) => s + l.cost, 0);
      const maintenanceCost = maintBy.get(v.id) ?? 0;
      const depreciation = depBy.get(v.id) ?? 0;
      const c = costPerKm({ distance, fuelCost, maintenanceCost, depreciation });
      return {
        assetId: v.id, assetName: v.nameAr, plateNumber: v.plateNumber,
        distance, liters: Math.round(logs.reduce((s, l) => s + l.liters, 0) * 100) / 100,
        fuelCost: c.breakdown.fuel, maintenanceCost: c.breakdown.maintenance, depreciation,
        per100: distance > 0 ? Math.round((cons.reduce((s, x) => s + x.liters, 0) / distance) * 100 * 100) / 100 : null,
        perKm: c.perKm,
        outliers: fuelOutliers(cons).length,
      };
    }).sort((a, b) => b.perKm - a.perKm);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Truck"
          title="الأسطول"
          subtitle="تكلفة الكيلومتر، ووقود مقابل مسافة، وورق قرب يخلص"
        />
        <FleetManager
          vehicles={vehicles}
          fuel={fuel}
          trips={tripRows.map((r) => ({
            id: r.t.id, assetId: r.t.assetId, assetName: r.assetName,
            driverEmployeeId: r.t.driverEmployeeId, driverName: r.driverName,
            startedAt: new Date(r.t.startedAt).toISOString().slice(0, 16).replace("T", " "),
            endedAt: r.t.endedAt ? new Date(r.t.endedAt).toISOString() : null,
            startMeter: Number(r.t.startMeter),
            endMeter: r.t.endMeter == null ? null : Number(r.t.endMeter),
            purpose: r.t.purpose,
          }))}
          economy={economy}
          drivers={maint.technicians}
          canManage={can("maintenance.manage")}
        />

        <MaintenanceManager {...maint} canManage={can("maintenance.manage")} fleetOnly />
      </div>
    );
  });
}
