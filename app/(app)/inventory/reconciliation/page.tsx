import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { inventoryAudits, inventoryAuditLines, fbaReimbursements } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/erp/pagination";
import { AuditStats, AuditLinesTable } from "@/components/erp/audit-summary";
import { AuditAdjustmentButton } from "@/components/erp/audit-adjustment-button";
import { selectCls } from "@/lib/utils";

const PER_PAGE = 100;
const dt = (d: Date | null) => (d ? new Date(d).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" }) : "—");
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Filter dropdown options (value → Arabic label), in a useful order.
const STATUS_OPTS: [string, string][] = [
  ["LOST", "مفقود"], ["DAMAGED", "تالف"], ["RESEARCHING", "قيد البحث"], ["RECEIVING", "قيد الاستلام"],
  ["FOUND", "زيادة"], ["UNMATCHED", "غير مربوط"], ["MATCHED", "مطابق"],
];
// Problems first, then biggest differences.
const ORDER = sql`CASE ${inventoryAuditLines.status} WHEN 'LOST' THEN 0 WHEN 'DAMAGED' THEN 1 WHEN 'RESEARCHING' THEN 2 WHEN 'RECEIVING' THEN 3 WHEN 'FOUND' THEN 4 WHEN 'UNMATCHED' THEN 5 ELSE 6 END`;

type SP = { page?: string; status?: string; q?: string };

export default async function InventoryReconciliationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const fStatus = one(sp.status);
  const fQ = one(sp.q).trim();
  const page = Math.max(1, Number(one(sp.page)) || 1);

  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const [audit] = await db.select().from(inventoryAudits)
      .where(eq(inventoryAudits.organizationId, orgId)).orderBy(desc(inventoryAudits.createdAt)).limit(1);
    // Show the fix-it bridge only when the audit found real qty diffs and the user may adjust.
    const hasQtyDiff = !!audit && (Number(audit.lost) > 0 || Number(audit.withDiff) > 0);
    const canAdjust = can("inventory.create");

    let lines: (typeof inventoryAuditLines.$inferSelect)[] = [];
    let total = 0;
    if (audit) {
      const conds = [eq(inventoryAuditLines.organizationId, orgId), eq(inventoryAuditLines.auditId, audit.id)];
      if (fStatus) conds.push(eq(inventoryAuditLines.status, fStatus));
      if (fQ) {
        const like = `%${fQ}%`;
        conds.push(or(ilike(inventoryAuditLines.code, like), ilike(inventoryAuditLines.asin, like), ilike(inventoryAuditLines.itemName, like))!);
      }
      const where = and(...conds);
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(inventoryAuditLines).where(where);
      total = Number(n ?? 0);
      lines = await db.select().from(inventoryAuditLines).where(where)
        .orderBy(ORDER, desc(sql`abs(${inventoryAuditLines.diff})`))
        .limit(PER_PAGE).offset((page - 1) * PER_PAGE);
    }
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));

    // SKUs Amazon already reimbursed (any reason) — badges the lost/damaged rows.
    let reimbursedSkus = new Set<string>();
    if (audit) {
      try {
        const rs = await db.selectDistinct({ sku: fbaReimbursements.sku }).from(fbaReimbursements)
          .where(eq(fbaReimbursements.organizationId, orgId));
        reimbursedSkus = new Set(rs.map((r) => r.sku).filter((s): s is string => !!s));
      } catch { /* feed not pulled yet — badges just stay off */ }
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ClipboardCheck" title="تدقيق مخزون FBA" subtitle="مطابقة كميات أمازون مع النظام — قراءة فقط، لا يغيّر المخزون" backHref="/inventory/stock"
          action={hasQtyDiff && canAdjust ? <AuditAdjustmentButton /> : undefined} />

        {!audit ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
            لا يوجد تدقيق بعد. شغّل «تدقيق المخزون» من صفحة منصّة أمازون.
          </CardContent></Card>
        ) : (
          <>
            <AuditStats audit={audit} />
            <div className="text-xs text-muted-foreground">آخر تدقيق: {dt(audit.finishedAt ?? audit.createdAt)} · يشمل فقط أصناف FBA اللي ليها كمية أو حالة (باقي الكتالوج لا يظهر). الأحمر (مفقود/تالف) يحتاج مراجعة؛ المؤقت (استلام/محجوز/بحث) طبيعي.</div>

            <Card>
              <CardContent className="pt-6">
                <form className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor="q">بحث (SKU / ASIN / الاسم)</Label>
                    <input id="q" name="q" defaultValue={fQ} placeholder="اكتب كود أو ASIN أو اسم…" className={selectCls} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="status">الحالة</Label>
                    <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                      <option value="">كل الحالات</option>
                      {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <Button type="submit">تطبيق</Button>
                </form>
              </CardContent>
            </Card>

            <div className="max-h-[70vh] overflow-auto rounded-xl border"><AuditLinesTable rows={lines} reimbursedSkus={reimbursedSkus} /></div>
            <Pagination page={page} pages={pages} total={total} unit="صنف" basePath="/inventory/reconciliation" params={{ status: fStatus, q: fQ }} />
          </>
        )}
      </div>
    );
  });
}
