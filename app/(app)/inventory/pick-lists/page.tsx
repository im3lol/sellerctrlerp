import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { pickLists, pickListLines, items, warehouses, deliveryNotes } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PickListSheet, type SheetDelivery, type SheetGroup } from "@/components/erp/pick-list-sheet";
import { groupForPicking, readyDeliveries } from "@/lib/erp/pick-list";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  OPEN: { label: "مفتوحة", variant: "secondary" },
  DONE: { label: "اتقفلت", variant: "default" },
  CANCELLED: { label: "ملغية", variant: "destructive" },
};
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" });
const n = (v: number) => v.toLocaleString("ar-EG-u-nu-latn");

/**
 * Picking rounds: many draft delivery notes, one walk through the warehouse. The list,
 * and one round's sheet at ?n=<number>. A round starts from «أذون الصرف» (select the
 * drafts → «جولة تجهيز»).
 */
export default async function PickListsPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const number = ((await searchParams).n ?? "").trim();

    if (number) {
      const [pl] = await db.select({ id: pickLists.id, number: pickLists.number, date: pickLists.date, status: pickLists.status, warehouse: warehouses.nameAr })
        .from(pickLists).leftJoin(warehouses, eq(warehouses.id, pickLists.warehouseId))
        .where(and(eq(pickLists.organizationId, orgId), eq(pickLists.number, number))).limit(1);
      if (!pl) notFound();

      const rows = await db.select({
        id: pickListLines.id, itemId: pickListLines.itemId, qty: pickListLines.quantity, picked: pickListLines.pickedQty,
        binCode: pickListLines.binCode, deliveryId: pickListLines.deliveryNoteId,
        dnNumber: deliveryNotes.number, dnStatus: deliveryNotes.status, code: items.code, name: items.nameAr,
      }).from(pickListLines)
        .leftJoin(items, eq(items.id, pickListLines.itemId))
        .leftJoin(deliveryNotes, eq(deliveryNotes.id, pickListLines.deliveryNoteId))
        .where(eq(pickListLines.pickListId, pl.id));

      const lines = rows.map((r) => ({
        id: r.id, deliveryId: r.deliveryId ?? "", itemId: r.itemId, qty: Number(r.qty), picked: Number(r.picked), binCode: r.binCode,
      }));
      const itemInfo = new Map(rows.map((r) => [r.itemId, { code: r.code ?? "", name: r.name ?? r.code ?? "" }]));
      const groups: SheetGroup[] = groupForPicking(lines).map((g) => ({ ...g, ...(itemInfo.get(g.itemId) ?? { code: "", name: "" }) }));
      const ready = readyDeliveries(lines);
      const byId = new Map<string, SheetDelivery>();
      for (const r of rows) {
        if (r.deliveryId && !byId.has(r.deliveryId)) {
          byId.set(r.deliveryId, { id: r.deliveryId, number: r.dnNumber ?? "—", status: r.dnStatus ?? "DRAFT", ready: ready.has(r.deliveryId) });
        }
      }
      const deliveries = [...byId.values()].sort((a, b) => a.number.localeCompare(b.number));
      const st = STATUS[pl.status] ?? { label: pl.status, variant: "secondary" as const };

      return (
        <div className="space-y-6">
          <ErpPageHeader
            icon="ScanLine"
            title={`جولة تجهيز ${pl.number}`}
            subtitle={`${pl.warehouse ?? "—"} · ${dt(pl.date)} · ${n(deliveries.length)} إذن · ${n(groups.length)} صنف`}
            backHref="/inventory/pick-lists"
            action={<Badge variant={st.variant}>{st.label}</Badge>}
          />
          <PickListSheet
            pickListId={pl.id} open={pl.status === "OPEN"} groups={groups} deliveries={deliveries}
            canConfirm={can("sales.confirm")} canCancel={can("sales.create")}
          />
        </div>
      );
    }

    const list = await db.select({
      id: pickLists.id, number: pickLists.number, date: pickLists.date, status: pickLists.status, warehouse: warehouses.nameAr,
      deliveries: sql<number>`count(distinct ${pickListLines.deliveryNoteId})::int`,
      itemCount: sql<number>`count(distinct ${pickListLines.itemId})::int`,
    }).from(pickLists)
      .leftJoin(warehouses, eq(warehouses.id, pickLists.warehouseId))
      .leftJoin(pickListLines, eq(pickListLines.pickListId, pickLists.id))
      .where(eq(pickLists.organizationId, orgId))
      .groupBy(pickLists.id, warehouses.nameAr)
      .orderBy(desc(pickLists.date)).limit(100);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ScanLine"
          title="جولات التجهيز"
          subtitle="جمّع أذون صرف كتير في لفّة واحدة على المخزن — من «أذون الصرف» حدّد المسودات ودوس «جولة تجهيز»."
          backHref="/inventory"
          action={<Button asChild variant="outline"><Link href="/sales/deliveries?status=DRAFT">أذون الصرف المسودة</Link></Button>}
        />
        <Card>
          <CardContent className="p-0">
            {list.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">لسه مفيش جولات — ابدأ من «أذون الصرف».</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">المخزن</TableHead>
                    <TableHead className="text-start">الأذون</TableHead>
                    <TableHead className="text-start">الأصناف</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => {
                    const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
                    return (
                      <TableRow key={r.id}>
                        <TableCell><Link href={`/inventory/pick-lists?n=${encodeURIComponent(r.number)}`} className="font-mono font-medium text-primary hover:underline">{r.number}</Link></TableCell>
                        <TableCell>{dt(r.date)}</TableCell>
                        <TableCell>{r.warehouse ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{n(r.deliveries)}</TableCell>
                        <TableCell className="tabular-nums">{n(r.itemCount)}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
