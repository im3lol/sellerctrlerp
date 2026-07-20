"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { importPlatformPaymentsAction, type PlatformPaymentsResult } from "@/app/actions/erp/platforms";
import { parseCsvWithHeader } from "@/lib/erp/csv";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { selectCls } from "@/lib/utils";

const guess = (headers: string[], keys: string[]) => {
  const idx = headers.findIndex((h) => keys.some((k) => h.toLowerCase().includes(k)));
  return idx >= 0 ? String(idx) : "";
};

type Mapping = { reference: string; amount: string; date: string };

export function PlatformPaymentsImport({ platformId, platformName, hasBank }: { platformId: string; platformName: string; hasBank: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({ reference: "", amount: "", date: "" });
  const [result, setResult] = useState<PlatformPaymentsResult | null>(null);

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
        reference: guess(h, ["payout", "settlement", "reference", "ref", "id", "المرجع", "رقم"]),
        amount: guess(h, ["amount", "total", "net", "المبلغ", "قيمة"]),
        date: guess(h, ["date", "التاريخ", "تاريخ"]),
      });
    };
    reader.readAsText(file, "utf-8");
  };

  const payments = useMemo(() => {
    if (!rows || map.reference === "" || map.amount === "") return [];
    const ri = +map.reference, ai = +map.amount, di = map.date === "" ? -1 : +map.date;
    const out: { reference: string; amount: number; date?: string }[] = [];
    for (const r of dataRows) {
      const reference = (r[ri] ?? "").trim();
      const amount = parseFloat((r[ai] ?? "").replace(/,/g, ""));
      if (!reference || !(amount > 0)) continue;
      out.push({ reference, amount, date: di >= 0 ? (r[di] ?? "").trim() || undefined : undefined });
    }
    return out;
  }, [rows, dataRows, map]);

  const ready = map.reference !== "" && map.amount !== "";

  const run = () => {
    if (payments.length === 0) return toast.error("اربط الأعمدة أولاً — لا توجد مدفوعات صالحة");
    start(async () => {
      const r = await importPlatformPaymentsAction(platformId, payments);
      setResult(r);
      if (r.ok) { toast.success(`تم إنشاء ${r.created} سند قبض${r.skippedDuplicate ? ` · تخطّي ${r.skippedDuplicate} مكرر` : ""}`); router.refresh(); }
      else toast.error(r.error);
    });
  };

  const colOptions = headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>);
  const MapSelect = ({ label, k, optional }: { label: string; k: keyof Mapping; optional?: boolean }) => (
    <div className="space-y-1.5">
      <Label>{label}{optional && <span className="text-muted-foreground"> (اختياري)</span>}</Label>
      <select className={selectCls} value={map[k]} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}>
        <option value="">— اختر العمود —</option>
        {colOptions}
      </select>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>استيراد المدفوعات — {platformName}</CardTitle>
        <CardDescription>ارفع ملف المدفوعات/التحويلات، اربط الأعمدة، ثم استورد. كل دفعة تصبح سند قبض (مسودة) باسم عميل المنصة على حسابها البنكي. أكّد السندات لترحيلها.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasBank && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            اضبط الحساب البنكي للمنصة أولًا (من تعديل المنصة) قبل استيراد المدفوعات.
          </div>
        )}
        <div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={!hasBank}>
            <Upload className="size-4" />{fileName ? "تغيير الملف" : "رفع ملف CSV"}
          </Button>
          {fileName && <span className="ms-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" />{fileName} · {dataRows.length} صف</span>}
        </div>

        {rows && (
          <>
            <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-3">
              <MapSelect label="المرجع / رقم الدفعة" k="reference" />
              <MapSelect label="المبلغ" k="amount" />
              <MapSelect label="التاريخ" k="date" optional />
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>{ready ? <>جاهز: <b>{payments.length}</b> دفعة</> : "اربط المرجع والمبلغ لعرض المعاينة."}</span>
              <Button onClick={run} disabled={pending || !ready || payments.length === 0}>
                {pending && <Loader2 className="size-4 animate-spin" />}استيراد {payments.length > 0 ? `(${payments.length})` : ""}
              </Button>
            </div>
          </>
        )}

        {result?.ok && (
          <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/20">
            <div>✅ تم إنشاء <b>{result.created}</b> سند قبض (مسودة).</div>
            {result.skippedDuplicate > 0 && <div>↷ تخطّي <b>{result.skippedDuplicate}</b> دفعة مكررة.</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
