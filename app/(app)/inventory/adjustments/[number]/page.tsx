import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockAdjustments, stockAdjustmentLines, items, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { StockRowActions } from "@/components/erp/stock-row-actions";
import { AdjustmentLinesEditor, type EditorLine } from "@/components/erp/adjustment-lines-editor";
import { DocAuditCard } from "@/components/erp/document-detail";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { getDocumentAudit } from "@/lib/erp/audit";
import { docNumberParam } from "@/lib/erp/doc-route";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function AdjustmentDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("inventory.view", async ({ orgId, role, can }) => {
    const number = await docNumberParam(raw, orgId, stockAdjustments,
      { id: stockAdjustments.id, number: stockAdjustments.number, organizationId: stockAdjustments.organizationId }, "/inventory/adjustments");
    const canManage = can("inventory.create");

    const [adj] = await db.select().from(stockAdjustments)
      .where(and(eq(stockAdjustments.number, number), eq(stockAdjustments.organizationId, orgId))).limit(1);
    if (!adj) notFound();
    const audit = await getDocumentAudit(orgId, adj.id);

    const lines = await db
      .select({
        id: stockAdjustmentLines.id,
        itemId: stockAdjustmentLines.itemId,
        warehouseId: stockAdjustmentLines.warehouseId,
        mode: stockAdjustmentLines.mode,
        itemCode: items.code,
        itemName: items.nameAr,
        warehouse: warehouses.nameAr,
        entered: stockAdjustmentLines.enteredValue,
        delta: stockAdjustmentLines.deltaQuantity,
        unitCost: stockAdjustmentLines.unitCost,
        totalValue: stockAdjustmentLines.totalValue,
      })
      .from(stockAdjustmentLines)
      .leftJoin(items, eq(items.id, stockAdjustmentLines.itemId))
      .leftJoin(warehouses, eq(warehouses.id, stockAdjustmentLines.warehouseId))
      .where(eq(stockAdjustmentLines.stockAdjustmentId, adj.id))
      .orderBy(asc(items.code));

    const isDraft = adj.status === "DRAFT";

    // Live on-hand + WAC per line pair — feeds the جرد editor for drafts.
    let editorLines: EditorLine[] = [];
    if (isDraft && canManage && lines.length > 0) {
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      const bal = await db.execute<{ item_id: string; warehouse_id: string; qty: string; value: string }>(sql`
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, warehouse_id, balance_quantity AS qty, balance_value AS value
        FROM stock_movements
        WHERE organization_id = ${orgId} AND item_id IN (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})
        ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
      `);
      const balBy = new Map(bal.rows.map((b) => [`${b.item_id}|${b.warehouse_id}`, { qty: Number(b.qty), value: Number(b.value) }]));
      // Org-wide WAC per item (sum of every warehouse's latest balance) — the
      // fallback when the line's warehouse holds nothing.
      const orgTotals = new Map<string, { qty: number; value: number }>();
      for (const b of bal.rows) {
        const t = orgTotals.get(b.item_id) ?? { qty: 0, value: 0 };
        t.qty += Number(b.qty); t.value += Number(b.value);
        orgTotals.set(b.item_id, t);
      }
      // Last purchase/intake cost per item — the final fallback (zero-stock items).
      const lastIn = await db.execute<{ item_id: string; cost: string }>(sql`
        SELECT DISTINCT ON (item_id) item_id, unit_cost AS cost
        FROM stock_movements
        WHERE organization_id = ${orgId} AND item_id IN (${sql.join(itemIds.map((i) => sql`${i}`), sql`, `)})
          AND type = 'IN' AND unit_cost > 0
        ORDER BY item_id, created_at DESC, split_part(number, '-', 3)::int DESC
      `);
      const lastInBy = new Map(lastIn.rows.map((r) => [r.item_id, Number(r.cost)]));
      const r2 = (n: number) => Math.round(n * 100) / 100;
      editorLines = lines.map((l) => {
        const b = balBy.get(`${l.itemId}|${l.warehouseId}`) ?? { qty: 0, value: 0 };
        const onHand = b.qty;
        const avgCost = b.qty > 1e-9 ? r2(b.value / b.qty) : 0;
        const org = orgTotals.get(l.itemId);
        const orgWac = org && org.qty > 1e-9 ? r2(org.value / org.qty) : 0;
        // Cost ladder: this warehouse's WAC → org-wide WAC → last intake cost.
        const defaultCost = avgCost > 0 ? avgCost : orgWac > 0 ? orgWac : lastInBy.get(l.itemId) ?? 0;
        // Default counted qty = the stored target: set-mode keeps its entered value;
        // delta-mode targets current + delta.
        const actual = l.mode === "set" ? Number(l.entered) : Math.max(0, onHand + Number(l.entered));
        return { lineId: l.id, itemCode: l.itemCode, itemName: l.itemName, warehouse: l.warehouse, onHand, avgCost, defaultCost, actual, unitCost: l.unitCost != null ? Number(l.unitCost) : null };
      });
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ClipboardCheck"
          title={`تسوية مخزون ${adj.number}`}
          subtitle={adj.reason}
          backHref="/inventory/adjustments"
          action={
            <div className="flex gap-2">
              <PrintDocLink href={`/erp/inventory/adjustments/${encodeURIComponent(adj.number)}/print`} />
              {canManage && isDraft && <StockRowActions docId={adj.id} docNumber={adj.number} type="adjustment" status={adj.status} canManage={canManage} dest="/inventory/adjustments" />}
            </div>
          }
        />

        <Card>
          <CardHeader><CardTitle>بيانات التسوية</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
            <div><div className="text-muted-foreground">الرقم</div><div className="font-mono font-medium">{adj.number}</div></div>
            <div><div className="text-muted-foreground">التاريخ</div><div className="font-medium">{dt(adj.date)}</div></div>
            <div><div className="text-muted-foreground">الوصف / السبب</div><div className="font-medium">{adj.reason}</div></div>
            <div><div className="text-muted-foreground">الحالة</div><Badge variant={adj.status === "POSTED" ? "default" : "secondary"}>{adj.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الأصناف</CardTitle>
            <CardDescription>{isDraft ? "عدّل «الكمية الفعلية» بعد الجرد — الفرق والقيمة تقديريان حتى التأكيد." : "القيم النهائية بعد الترحيل."}</CardDescription>
          </CardHeader>
          <CardContent>
            {isDraft && canManage ? (
              <AdjustmentLinesEditor adjId={adj.id} lines={editorLines} />
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المخزن</TableHead>
                  <TableHead className="text-start">الكمية الفعلية</TableHead>
                  <TableHead className="text-start">الفرق</TableHead>
                  <TableHead className="text-start">السعر</TableHead>
                  <TableHead className="text-start">القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const delta = Number(l.delta);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={l.itemName ?? undefined}><span className="font-mono text-xs text-muted-foreground">{l.itemCode}</span> {l.itemName}</div></TableCell>
                      <TableCell>{l.warehouse ?? "—"}</TableCell>
                      <TableCell>{q(l.entered)}</TableCell>
                      <TableCell className={delta < 0 ? "text-destructive" : delta > 0 ? "text-emerald-600" : ""}>{delta > 0 ? "+" : ""}{q(delta)}</TableCell>
                      <TableCell>{l.unitCost != null ? fmt(l.unitCost) : "—"}</TableCell>
                      <TableCell>{fmt(l.totalValue)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={5}>الإجمالي</TableCell>
                  <TableCell>{fmt(adj.totalValue)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            )}
          </CardContent>
        </Card>

        <DocAuditCard rows={audit} />
      </div>
    );
  });
}
