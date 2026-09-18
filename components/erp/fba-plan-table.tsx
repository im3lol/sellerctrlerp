"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockTransferAction } from "@/app/actions/erp/stock-transfers";
import { toCsv } from "@/lib/erp/csv";
import type { FbaPlanRow } from "@/lib/erp/fba-plan";
import type { ReorderStatus } from "@/lib/erp/reorder";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";

const STATUS: Record<ReorderStatus, { label: string; variant: "destructive" | "secondary" | "outline" }> = {
  out: { label: "خلص في أمازون", variant: "destructive" },
  critical: { label: "هيخلص قبل ما الشحنة توصل", variant: "destructive" },
  low: { label: "أقل من التغطية", variant: "secondary" },
  ok: { label: "كويس", variant: "outline" },
};
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dec = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 });
const BOM = String.fromCharCode(0xfeff); // so Excel reads the Arabic titles

/**
 * The plan, editable: every quantity can be changed (up to what the source warehouse
 * holds). The result leaves as a shipment file for Send to Amazon and/or a DRAFT transfer
 * to the FBA warehouse — confirmed by a person once the boxes actually leave.
 */
export function FbaPlanTable({ rows, fromWarehouseId, toWarehouseId, sourceName, windowDays, canCreate }: {
  rows: FbaPlanRow[]; fromWarehouseId: string; toWarehouseId: string; sourceName: string; windowDays: number; canCreate: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(rows.map((r) => [r.itemId, r.sendQty])));
  const chosen = rows.filter((r) => (qty[r.itemId] ?? 0) > 0);
  const units = chosen.reduce((s, r) => s + qty[r.itemId], 0);
  const amazonOnHand = rows.reduce((s, r) => s + r.fbaAvailable, 0);
  const systemOnHand = rows.reduce((s, r) => s + r.sourceOnHand, 0);
  const salesInWindow = rows.reduce((s, r) => s + r.soldAtAmazon, 0);

  const download = () => {
    const csv = toCsv(["Merchant SKU", "ASIN", "Title", "Quantity"],
      chosen.map((r) => [r.sku ?? r.code, r.asin ?? "", r.name, qty[r.itemId]]));
    const url = URL.createObjectURL(new Blob([BOM + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `fba-shipment-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const excel = async () => {
    const XLSX = await import("xlsx"); // loaded on click — keeps the page bundle light
    const ws = XLSX.utils.aoa_to_sheet([
      ["الصنف", "SKU", "ASIN", `مبيعات آخر ${windowDays} يوم`, "بيع/يوم", "متاح في أمازون", "في الطريق", "يكفّي (يوم)", "المطلوب", `في «${sourceName}»`, "هتبعت", "الحالة"],
      ...rows.map((r) => [r.name, r.sku ?? r.code, r.asin ?? "", r.soldAtAmazon, Math.round(r.velocity * 10) / 10, r.fbaAvailable, r.fbaInbound,
        Math.round(r.daysOfCover * 10) / 10, r.suggestedQty, Math.floor(r.sourceOnHand), qty[r.itemId] ?? 0, STATUS[r.status].label]),
      ["الإجمالي", "", "", salesInWindow, "", amazonOnHand, "", "", "", systemOnHand, units, ""],
    ]);
    ws["!cols"] = [36, 16, 14, 14, 10, 14, 12, 12, 10, 14, 10, 22].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "خطة شحن FBA");
    XLSX.writeFile(wb, `fba-plan-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const transfer = () => start(async () => {
    const r = await createStockTransferAction({
      date: new Date().toISOString().slice(0, 10),
      notes: "خطة شحن FBA",
      lines: chosen.map((x) => ({ itemId: x.itemId, fromWarehouseId, toWarehouseId, quantity: qty[x.itemId] })),
    });
    if (!r.ok || !r.number) { toast.error(r.error ?? "تعذّر إنشاء التحويل"); return; }
    toast.success(`تحويل مسودة ${r.number} — أكّده لما الشحنة تطلع فعلاً`);
    router.push(`/inventory/transfers/${encodeURIComponent(r.number)}`);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">{int(chosen.length)} صنف · {int(units)} وحدة</span>
        <div className="ms-auto flex flex-wrap gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={excel}>
            <Icon name="FileSpreadsheet" className="size-4" />Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Icon name="Printer" className="size-4" />طباعة
          </Button>
          <Button size="sm" variant="outline" disabled={chosen.length === 0} onClick={download}
            title="SKU وكمية لكل صنف — للرفع أو النسخ في Send to Amazon">
            <Icon name="Download" className="size-4" />ملف الشحنة (CSV)
          </Button>
          {canCreate && (
            <Button size="sm" disabled={pending || chosen.length === 0} onClick={transfer}
              title={`تحويل مسودة من «${sourceName}» لمخزن أمازون — مفيش مخزون بيتحرك غير لما تأكّده`}>
              <Icon name="ArrowLeftRight" className="size-4" />تحويل مسودة لمخزن أمازون
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border px-3 py-2 text-sm"><span className="text-muted-foreground">مخزون Amazon الحالي</span><div className="font-semibold tabular-nums">{int(amazonOnHand)} وحدة</div></div>
        <div className="rounded-lg border px-3 py-2 text-sm"><span className="text-muted-foreground">مخزون النظام في «{sourceName}»</span><div className="font-semibold tabular-nums">{int(systemOnHand)} وحدة</div></div>
        <div className="rounded-lg border px-3 py-2 text-sm"><span className="text-muted-foreground">مبيعات Amazon آخر {int(windowDays)} يوم</span><div className="font-semibold tabular-nums">{int(salesInWindow)} وحدة</div></div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">الصنف</TableHead>
              <TableHead className="text-start whitespace-nowrap">مبيعات آخر {int(windowDays)} يوم</TableHead>
              <TableHead className="text-start">بيع/يوم</TableHead>
              <TableHead className="text-start">متاح في أمازون</TableHead>
              <TableHead className="text-start">في الطريق</TableHead>
              <TableHead className="text-start">يكفّي (يوم)</TableHead>
              <TableHead className="text-start">المطلوب</TableHead>
              <TableHead className="text-start whitespace-nowrap">في النظام «{sourceName}»</TableHead>
              <TableHead className="text-start">هتبعت</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const max = Math.floor(r.sourceOnHand);
              return (
                <TableRow key={r.itemId}>
                  <TableCell className="max-w-[240px]">
                    <div className="truncate font-medium" title={r.name}>{r.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.sku ?? r.code}{r.asin ? ` · ${r.asin}` : ""}</div>
                  </TableCell>
                  <TableCell className="tabular-nums">{int(r.soldAtAmazon)}</TableCell>
                  <TableCell className="tabular-nums">{dec(r.velocity)}</TableCell>
                  <TableCell className="tabular-nums">{int(r.fbaAvailable)}</TableCell>
                  <TableCell className="tabular-nums">{int(r.fbaInbound)}</TableCell>
                  <TableCell className="tabular-nums">{dec(r.daysOfCover)}</TableCell>
                  <TableCell className="tabular-nums">{int(r.suggestedQty)}</TableCell>
                  <TableCell className="tabular-nums">{int(max)}</TableCell>
                  <TableCell>
                    <Input type="number" min={0} max={max} step={1} className="w-24 tabular-nums" aria-label={`كمية ${r.name}`}
                      value={qty[r.itemId] ?? 0}
                      onChange={(e) => {
                        const v = Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0)));
                        setQty((q) => ({ ...q, [r.itemId]: v }));
                      }} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                      {r.short > 0 && (
                        <Badge variant="outline" title="مش موجود في المخزن ده — اشتريه أو ابعته من مخزن تاني">ناقص {int(r.short)}</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
