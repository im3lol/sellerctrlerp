"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { importPlatformRemovalsAction, type PlatformRemovalsResult } from "@/app/actions/erp/platform-removals";
import { parseCsvWithHeader } from "@/lib/erp/csv";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const guess = (h: string[], keys: string[]) => { const i = h.findIndex((x) => keys.some((k) => x.toLowerCase().includes(k))); return i >= 0 ? String(i) : ""; };

type Mapping = { sku: string; disposed: string; returned: string };

export function PlatformRemovalsImport({ platformId, platformName, hasWarehouse }: { platformId: string; platformName: string; hasWarehouse: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({ sku: "", disposed: "", returned: "" });
  const [result, setResult] = useState<PlatformRemovalsResult | null>(null);

  const headers = rows?.[0] ?? [];
  const dataRows = useMemo(() => rows?.slice(1) ?? [], [rows]);

  const onFile = (file: File) => {
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsvWithHeader(String(reader.result ?? ""));
      if (parsed.length < 2) { toast.error("الملف فارغ أو بلا بيانات"); return; }
      setRows(parsed); setFileName(file.name);
      const h = parsed[0];
      setMap({
        sku: guess(h, ["sku", "fnsku", "الصنف", "كود"]),
        disposed: guess(h, ["disposed-quantity", "disposed", "إتلاف", "متلف"]),
        returned: guess(h, ["shipped-quantity", "shipped", "removed", "مرتجع", "returned"]),
      });
    };
    reader.readAsText(file, "utf-8");
  };

  const removals = useMemo(() => {
    if (!rows || map.sku === "" || (map.disposed === "" && map.returned === "")) return [];
    const si = +map.sku, di = map.disposed === "" ? -1 : +map.disposed, ri = map.returned === "" ? -1 : +map.returned;
    const out: { sku: string; disposed: number; returned: number }[] = [];
    for (const r of dataRows) {
      const sku = (r[si] ?? "").trim(); if (!sku) continue;
      const disposed = di >= 0 ? parseFloat((r[di] ?? "").replace(/,/g, "")) || 0 : 0;
      const returned = ri >= 0 ? parseFloat((r[ri] ?? "").replace(/,/g, "")) || 0 : 0;
      if (disposed <= 0 && returned <= 0) continue;
      out.push({ sku, disposed, returned });
    }
    return out;
  }, [rows, dataRows, map]);

  const ready = map.sku !== "" && (map.disposed !== "" || map.returned !== "");

  const run = () => {
    if (removals.length === 0) return toast.error("اربط الأعمدة أولاً — لا توجد إزالات صالحة");
    start(async () => {
      const r = await importPlatformRemovalsAction(platformId, removals);
      setResult(r);
      if (r.ok) { toast.success(`إتلاف ${int(r.matchedDisposedUnits)} وحدة${r.adjustmentId ? " — أُنشئت تسوية مسودة" : ""}`); router.refresh(); }
      else toast.error(r.error);
    });
  };

  const colOptions = headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>);
  const MapSelect = ({ label, k, optional }: { label: string; k: keyof Mapping; optional?: boolean }) => (
    <div className="space-y-1.5">
      <Label>{label}{optional && <span className="text-muted-foreground"> (اختياري)</span>}</Label>
      <select className={selectCls} value={map[k]} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}>
        <option value="">— اختر العمود —</option>{colOptions}
      </select>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>الإزالات والإتلاف — {platformName}</CardTitle>
        <CardDescription>ارفع تقرير الإزالة (Removal Order/Shipment Detail). الوحدات المُتلَفة (Disposed) تُسجَّل كخسارة مخزون عبر تسوية (مسودة) في مخزن المنصة؛ الوحدات المُرتجَعة للبائع تُعرَض للحصر فقط. لا تؤكّد التسوية لو سبق وطابقت المخزون بالدفتر (تجنبًا للتكرار).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasWarehouse && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">اضبط المخزن الافتراضي للمنصة أولًا قبل تسجيل الإتلاف.</div>
        )}
        <div>
          <input ref={inputRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={!hasWarehouse}><Upload className="size-4" />{fileName ? "تغيير الملف" : "رفع ملف CSV"}</Button>
          {fileName && <span className="ms-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" />{fileName} · {dataRows.length} صف</span>}
        </div>

        {rows && (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-3">
              <MapSelect label="كود الصنف / SKU" k="sku" />
              <MapSelect label="كمية الإتلاف (Disposed)" k="disposed" optional />
              <MapSelect label="كمية الإرجاع للبائع (Shipped)" k="returned" optional />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>{ready ? <>جاهز: <b>{int(removals.length)}</b> سطر</> : "اربط الصنف وعمود إتلاف أو إرجاع."}</span>
              <Button onClick={run} disabled={pending || !ready || removals.length === 0}>{pending && <Loader2 className="size-4 animate-spin" />}استيراد</Button>
            </div>
          </>
        )}

        {result?.ok && (
          <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/20">
            <div>إجمالي المُتلَف: <b>{int(result.totalDisposed)}</b> · المُرتجَع للبائع: <b>{int(result.totalReturned)}</b> وحدة.</div>
            <div>طوبق <b>{int(result.matchedItems)}</b> صنف · تم إتلاف <b>{int(result.matchedDisposedUnits)}</b> وحدة (خسارة).</div>
            {result.adjustmentId && (
              <div>📝 <Link href={`/erp/inventory/adjustments/${result.adjustmentId}`} className="text-primary underline">تسوية الإتلاف (مسودة)</Link> — راجعها وأكّدها لترحيل الخسارة.</div>
            )}
            {result.unmatched > 0 && <div className="text-muted-foreground">⚠ {int(result.unmatched)} SKU غير مربوط: <span className="font-mono text-xs">{result.unmatchedSkus.join("، ")}</span></div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
