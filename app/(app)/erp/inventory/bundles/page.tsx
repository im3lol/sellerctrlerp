import { aliasedTable, and, asc, desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { itemComponents, stockAssemblies, items, warehouses } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { BundlesManager } from "@/components/erp/bundles-manager";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function BundlesPage() {
  const { orgId, can } = await requireErpModule("inventory.view");
  const canManage = can("inventory.create");

  const p = aliasedTable(items, "p");
  const c = aliasedTable(items, "c");

  const [bomRows, itemList, whList, asmRows] = await Promise.all([
    db.select({ parentItemId: itemComponents.parentItemId, parentName: p.nameAr, parentCode: p.code, componentItemId: itemComponents.componentItemId, compName: c.nameAr, compCode: c.code, quantity: itemComponents.quantity })
      .from(itemComponents)
      .innerJoin(p, eq(p.id, itemComponents.parentItemId))
      .innerJoin(c, eq(c.id, itemComponents.componentItemId))
      .where(eq(itemComponents.organizationId, orgId))
      .orderBy(asc(p.nameAr)),
    db.select({ id: items.id, code: items.code, name: items.nameAr })
      .from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
    db.select({ id: warehouses.id, name: warehouses.nameAr })
      .from(warehouses).where(eq(warehouses.organizationId, orgId)).orderBy(asc(warehouses.nameAr)),
    db.select({ number: stockAssemblies.number, date: stockAssemblies.date, quantity: stockAssemblies.quantity, totalCost: stockAssemblies.totalCost, kit: items.nameAr, warehouse: warehouses.nameAr })
      .from(stockAssemblies)
      .leftJoin(items, eq(items.id, stockAssemblies.kitItemId))
      .leftJoin(warehouses, eq(warehouses.id, stockAssemblies.warehouseId))
      .where(eq(stockAssemblies.organizationId, orgId))
      .orderBy(desc(stockAssemblies.createdAt)).limit(15),
  ]);

  // Group BOM rows by parent.
  const bundleMap = new Map<string, { parentItemId: string; name: string; code: string | null; components: { id: string; name: string | null; code: string | null; quantity: number }[] }>();
  for (const r of bomRows) {
    let b = bundleMap.get(r.parentItemId);
    if (!b) { b = { parentItemId: r.parentItemId, name: r.parentName ?? "", code: r.parentCode, components: [] }; bundleMap.set(r.parentItemId, b); }
    b.components.push({ id: r.componentItemId, name: r.compName, code: r.compCode, quantity: Number(r.quantity) });
  }

  const bundles = [...bundleMap.values()];
  const itemsOpt = itemList.map((i) => ({ id: i.id, code: i.code, name: i.name }));
  const assemblies = asmRows.map((a) => ({ number: a.number, date: dt(a.date), quantity: Number(a.quantity), totalCost: Number(a.totalCost), kit: a.kit ?? "—", warehouse: a.warehouse ?? "—" }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Boxes" title="الحزم والمجموعات" subtitle="عرّف مكوّنات الحزمة وجمّعها إلى مخزون قابل للبيع" />
      <BundlesManager bundles={bundles} items={itemsOpt} warehouses={whList} assemblies={assemblies} canManage={canManage} />
    </div>
  );
}
