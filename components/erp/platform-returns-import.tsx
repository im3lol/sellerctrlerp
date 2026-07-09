"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { importPlatformReturnsAction, type PlatformReturnsResult } from "@/app/actions/erp/platform-returns";
import { parseCsvWithHeader } from "@/lib/erp/csv";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const guess = (h: string[], keys: string[]) => { const i = h.findIndex((x) => keys.some((k) => x.toLowerCase().includes(k))); return i >= 0 ? String(i) : ""; };

type Mapping = { order: string; sku: string; qty: string; date: string };

export function PlatformReturnsImport({ platformId, platformName }: { platformId: string; platformName: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({ order: "", sku: "", qty: "", date: "" });
  const [result, setResult] = useState<PlatformReturnsResult | null>(null);

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
        order: guess(h, ["order-id", "order id", "orderid", "رقم الطلب"]),
        sku: guess(h, ["sku", "asin", "fnsku", "الصنف", "كود"]),
        qty: guess(h, ["quantity", "qty", "الكمية"]),
        date: guess(h, ["return-date", "date", "التاريخ"]),
      });
    };
    reader.readAsText(file, "utf-8");
  };

  const returns = useMemo(() => {
    if (!rows || map.order === "" || map.sku === "" || map.qty === "") return [];
    const oi = +map.order, si = +map.sku, qi = +map.qty, di = map.date === "" ? -1 : +map.date;
    const out: { externalOrderId: string; sku: string; quantity: number; date?: string }[] = [];
    for (const r of dataRows) {
      const externalOrderId = (r[oi] ?? "").trim(); const sku = (r[si] ?? "").trim();
      const quantity = parseFloat((r[qi] ?? "").replace(/,/g, ""));
      if (!externalOrderId || !sku || !(quantity > 0)) continue;
      out.push({ externalOrderId, sku, quantity, date: di >= 0 ? (r[di] ?? "").trim() || undefined : undefined });
    }
    return out;
  }, [rows, dataRows, map]);

  const ready = map.order !== "" && map.sku !== "" && map.qty !== "";

  const run = () => {
    if (returns.length === 0) return toast.error("اربط الأعمدة أولاً — لا توجد مرتجعات صالحة");
    start(async () => {
      const r = await importPlatformReturnsAction(platformId, returns);
      setResult(r);
      if (r.ok) { toast.success(`تم تسجيل ${int(r.created)} مرتجع`); router.refresh(); }
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
        <CardTitle>استيراد المرتجعات — {platformName}</CardTitle>
        <CardDescription>ارفع تقرير مرتجعات العملاء (FBA Customer Returns)، اربط الأعمدة، ثم استورد. لكل مرتجع نطابق أمر البيع وفاتورته المُرحّلة، ونُنشئ إشعار خصم + نُعيد الصنف للمخزون. المكرر يُتخطّى.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <input ref={inputRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <Button variant="outline" onClick={() => inputRef.current?.click()}><Upload className="size-4" />{fileName ? "تغيير الملف" : "رفع ملف CSV"}</Button>
          {fileName && <span className="ms-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" />{fileName} · {dataRows.length} صف</span>}
        </div>

        {rows && (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-4">
              <MapSelect label="رقم الطلب" k="order" />
              <MapSelect label="كود الصنف / SKU" k="sku" />
              <MapSelect label="الكمية المرتجعة" k="qty" />
              <MapSelect label="التاريخ" k="date" optional />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>{ready ? <>جاهز: <b>{int(returns.length)}</b> مرتجع</> : "اربط الطلب والصنف والكمية للمعاينة."}</span>
              <Button onClick={run} disabled={pending || !ready || returns.length === 0}>{pending && <Loader2 className="size-4 animate-spin" />}استيراد {returns.length > 0 ? `(${int(returns.length)})` : ""}</Button>
            </div>
          </>
        )}

        {result?.ok && (
          <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/20">
            <div>✅ تم تسجيل <b>{int(result.created)}</b> مرتجع (إشعار خصم + إعادة للمخزون).</div>
            {result.skippedDuplicate > 0 && <div>↷ تخطّي <b>{int(result.skippedDuplicate)}</b> مرتجع مكرر.</div>}
            {result.restockFailed > 0 && <div className="text-destructive">⚠ <b>{int(result.restockFailed)}</b> مرتجع: تم الإشعار المالي لكن تعذّرت إعادة المخزون — أعِدها يدويًا.</div>}
            {(result.noOrder + result.noInvoice + result.notOnInvoice + result.unmatchedSku + result.failed) > 0 && (
              <div className="mt-1 text-muted-foreground">
                لم تُعالَج: {result.noOrder > 0 && <span>{int(result.noOrder)} بلا أمر مطابق · </span>}
                {result.noInvoice > 0 && <span>{int(result.noInvoice)} بلا فاتورة مُرحّلة · </span>}
                {result.notOnInvoice > 0 && <span>{int(result.notOnInvoice)} الصنف ليس على الفاتورة · </span>}
                {result.unmatchedSku > 0 && <span>{int(result.unmatchedSku)} SKU غير مربوط · </span>}
                {result.failed > 0 && <span className="text-destructive">{int(result.failed)} فشل</span>}
              </div>
            )}
            {result.unmatchedSkus.length > 0 && <div className="font-mono text-xs text-muted-foreground">أكواد غير مربوطة: {result.unmatchedSkus.join("، ")}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
