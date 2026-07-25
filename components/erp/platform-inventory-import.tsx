"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { reconcilePlatformInventoryAction, applyInventoryReconciliationAction, type InventoryReconActionResult } from "@/app/actions/erp/platform-inventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`text-xl font-bold tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div></div>;
}

export function PlatformInventoryImport({ platformId, platformName, hasWarehouse }: { platformId: string; platformName: string; hasWarehouse: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<InventoryReconActionResult | null>(null);

  const onFile = (file: File) => {
    setFileName(file.name);
    const fd = new FormData(); fd.set("file", file);
    start(async () => {
      const r = await reconcilePlatformInventoryAction(platformId, fd);
      setResult(r);
      if (!r.ok) toast.error(r.error);
      else toast.success(`طوبق ${int(r.matched)} صنف · ${int(r.withDiff)} فرق`);
    });
  };

  const apply = () => {
    if (!result?.ok) return;
    const entries = result.rows.filter((r) => Math.abs(r.diff) > 0.001).map((r) => ({ itemId: r.itemId, qty: r.marketplaceQty }));
    if (entries.length === 0) return toast.error("لا توجد فروق للمطابقة");
    startApply(async () => {
      const r = await applyInventoryReconciliationAction(platformId, entries);
      if (r.ok) { toast.success("تم إنشاء تسوية مخزون (مسودة) — أكّدها لترحيلها"); router.push(r.id ? `/inventory/adjustments/${r.id}` : "/inventory/adjustments"); router.refresh(); }
      else toast.error(r.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>مطابقة المخزون — {platformName}</CardTitle>
        <CardDescription>ارفع تقرير دفتر مخزون أمازون (Inventory Ledger). نحسب الرصيد لكل SKU ونطابقه بمخزون المنصة، ثم يمكنك إنشاء تسوية لضبط الفروق.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasWarehouse && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">اضبط المخزن الافتراضي للمنصة أولًا (من تعديل المنصة) قبل مطابقة المخزون.</div>
        )}
        <div>
          <input ref={inputRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={!hasWarehouse || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{fileName ? "تغيير الملف" : "رفع دفتر المخزون"}
          </Button>
          {fileName && <span className="ms-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" />{fileName}</span>}
        </div>

        {result?.ok && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="أصناف في الملف" value={int(result.totalSkus)} />
              <Stat label="إجمالي الوحدات" value={int(result.totalUnits)} />
              <Stat label="مطابَقة بأصناف" value={int(result.matched)} />
              <Stat label="غير مربوطة" value={int(result.unmatched)} tone={result.unmatched > 0 ? "danger" : undefined} />
              <Stat label="بها فروق" value={int(result.withDiff)} tone={result.withDiff > 0 ? "danger" : undefined} />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>المخزن: <b>{result.warehouseName}</b>. التسوية تضبط رصيد النظام = رصيد أمازون للأصناف المطابَقة.</span>
              <Button onClick={apply} disabled={applying || result.withDiff === 0}>{applying && <Loader2 className="size-4 animate-spin" />}إنشاء تسوية ({int(result.withDiff)})</Button>
            </div>

            {result.rows.length > 0 && (
              <div className="max-h-96 overflow-y-auto rounded-xl border">
                <Table>
                  <TableHeader><TableRow><TableHead className="text-start">الصنف</TableHead><TableHead className="text-start">أمازون</TableHead><TableHead className="text-start">النظام</TableHead><TableHead className="text-start">الفرق</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {result.rows.map((r) => (
                      <TableRow key={r.itemId}>
                        <TableCell className="max-w-[22rem] whitespace-normal"><div dir="ltr" className="line-clamp-2 text-start leading-snug" title={r.itemName}>{r.itemName}</div><div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.code}</div></TableCell>
                        <TableCell className="tabular-nums">{int(r.marketplaceQty)}</TableCell>
                        <TableCell className="tabular-nums">{int(r.erpQty)}</TableCell>
                        <TableCell className={`tabular-nums font-medium ${r.diff !== 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.diff > 0 ? "+" : ""}{int(r.diff)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {result.unmatched > 0 && (
              <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                ⚠ {int(result.unmatched)} SKU غير مربوط بصنف في النظام (لن يدخل التسوية). عيّنة: <span className="font-mono">{result.unmatchedSample.slice(0, 20).join("، ")}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
