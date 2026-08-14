"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { importPlatformOrdersAction, type PlatformImportResult } from "@/app/actions/erp/platforms";
import { parseCsvWithHeader } from "@/lib/erp/csv";
import { Button } from "@/components/ui/button";
import { ColumnMapSelect } from "@/components/erp/column-map-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";


const guess = (headers: string[], keys: string[]) => {
  const idx = headers.findIndex((h) => keys.some((k) => h.toLowerCase().includes(k)));
  return idx >= 0 ? String(idx) : "";
};

type Mapping = { order: string; code: string; qty: string; price: string; date: string };

export function PlatformImport({ platformId, platformName }: { platformId: string; platformName: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({ order: "", code: "", qty: "", price: "", date: "" });
  const [result, setResult] = useState<PlatformImportResult | null>(null);

  const headers = rows?.[0] ?? [];
  const dataRows = useMemo(() => rows?.slice(1) ?? [], [rows]);

  const onFile = (file: File) => {
    setResult(null);
    const finish = (parsed: string[][]) => {
      if (parsed.length < 2) { toast.error("الملف فارغ أو بلا بيانات"); return; }
      setRows(parsed);
      setFileName(file.name);
      const h = parsed[0];
      setMap({
        order: guess(h, ["order id", "order-id", "orderid", "رقم الطلب", "الطلب"]),
        code: guess(h, ["sku", "asin", "code", "الصنف", "كود"]),
        qty: guess(h, ["qty", "quantity", "الكمية", "كمية"]),
        price: guess(h, ["price", "unit", "السعر", "سعر"]),
        date: guess(h, ["date", "التاريخ", "تاريخ"]),
      });
    };
    if (/\.xlsx?$/i.test(file.name)) {
      // Excel: lazy-load the parser (already a dependency via the settlements flow)
      // so CSV-only users never pay for the bundle. First sheet, same rows shape.
      file.arrayBuffer()
        .then(async (buf) => {
          const XLSX = await import("xlsx");
          const ws = XLSX.read(buf, { type: "array" }).Sheets;
          const first = ws[Object.keys(ws)[0]];
          const parsed = (XLSX.utils.sheet_to_json(first, { header: 1, raw: false, defval: "" }) as unknown[][])
            .map((r) => r.map((c) => String(c ?? "")));
          finish(parsed);
        })
        .catch(() => toast.error("تعذّرت قراءة ملف Excel"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => finish(parseCsvWithHeader(String(reader.result ?? "")));
    reader.readAsText(file, "utf-8");
  };

  const orders = useMemo(() => {
    if (!rows || map.order === "" || map.code === "" || map.qty === "" || map.price === "") return [];
    const oi = +map.order, ci = +map.code, qi = +map.qty, pi = +map.price, di = map.date === "" ? -1 : +map.date;
    const byId = new Map<string, { externalOrderId: string; date?: string; lines: { code: string; quantity: number; unitPrice: number }[] }>();
    for (const r of dataRows) {
      const ext = (r[oi] ?? "").trim();
      const code = (r[ci] ?? "").trim();
      const qty = parseFloat((r[qi] ?? "").replace(/,/g, ""));
      const price = parseFloat((r[pi] ?? "").replace(/,/g, ""));
      if (!ext || !code || !(qty > 0)) continue;
      let o = byId.get(ext);
      if (!o) { o = { externalOrderId: ext, date: di >= 0 ? (r[di] ?? "").trim() || undefined : undefined, lines: [] }; byId.set(ext, o); }
      o.lines.push({ code, quantity: qty, unitPrice: isNaN(price) ? 0 : price });
    }
    return [...byId.values()];
  }, [rows, dataRows, map]);

  const mappingReady = map.order !== "" && map.code !== "" && map.qty !== "" && map.price !== "";

  const run = () => {
    if (orders.length === 0) return toast.error("اربط الأعمدة أولاً — لا توجد أوامر صالحة");
    start(async () => {
      const r = await importPlatformOrdersAction(platformId, orders);
      setResult(r);
      if (r.ok) {
        toast.success(`تم استيراد ${r.created} أمر${r.skippedDuplicate ? ` · تخطّي ${r.skippedDuplicate} مكرر` : ""}`);
        router.refresh();
      } else toast.error(r.error);
    });
  };

  const colOptions = headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>);
  // Plain props factory, NOT a component — see components/erp/column-map-select.tsx.
  const mapProps = (k: keyof Mapping) => ({
    value: map[k],
    colOptions,
    onChange: (v: string) => setMap((m) => ({ ...m, [k]: v })),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>استيراد أوامر — {platformName}</CardTitle>
        <CardDescription>ارفع ملف CSV أو Excel من المنصة، اربط الأعمدة، ثم استورد. كل رقم طلب يصبح أمر بيع باسم عميل المنصة. المكرر يُتخطّى تلقائيًا.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" />{fileName ? "تغيير الملف" : "رفع ملف CSV / Excel"}
          </Button>
          {fileName && <span className="ms-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" />{fileName} · {dataRows.length} صف</span>}
        </div>

        {rows && (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-5">
              <ColumnMapSelect label="رقم الطلب" {...mapProps("order")} />
              <ColumnMapSelect label="كود الصنف / SKU" {...mapProps("code")} />
              <ColumnMapSelect label="الكمية" {...mapProps("qty")} />
              <ColumnMapSelect label="سعر الوحدة" {...mapProps("price")} />
              <ColumnMapSelect label="التاريخ" {...mapProps("date")} optional />
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>{mappingReady ? <>جاهز: <b>{orders.length}</b> أمر · <b>{orders.reduce((s, o) => s + o.lines.length, 0)}</b> بند</> : "اربط الأعمدة الأساسية لعرض المعاينة."}</span>
              <Button onClick={run} disabled={pending || !mappingReady || orders.length === 0}>
                {pending && <Loader2 className="size-4 animate-spin" />}استيراد {orders.length > 0 ? `(${orders.length})` : ""}
              </Button>
            </div>
          </>
        )}

        {result?.ok && (
          <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/20">
            <div>✅ تم إنشاء <b>{result.created}</b> أمر بيع (مسودة).</div>
            {result.skippedDuplicate > 0 && <div>↷ تخطّي <b>{result.skippedDuplicate}</b> أمر مكرر (مستورد سابقًا).</div>}
            {result.unmatched.length > 0 && (
              <div className="text-destructive">
                ⚠ {result.unmatched.length} كود غير مربوط بصنف — رُبطها أولًا ثم أعد الاستيراد:
                <div className="mt-1 font-mono text-xs">{result.unmatched.slice(0, 30).join("، ")}{result.unmatched.length > 30 ? " …" : ""}</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
