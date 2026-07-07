"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { previewAmazonSettlementAction, runAmazonSettlementAction, type SettlementPreview } from "@/app/actions/erp/amazon-settlement";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPE_AR: Record<string, string> = {
  Order: "طلبات", Refund: "مرتجعات", Transfer: "تحويلات بنكية",
  "Service Fee": "رسوم خدمة", "SAFE-T reimbursement": "تعويضات SAFE-T", "FBA Inventory Fee": "رسوم مخزون FBA",
};

export function SettlementImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Extract<SettlementPreview, { ok: true }> | null>(null);
  const [previewing, startPreview] = useTransition();
  const [importing, startImport] = useTransition();

  const doPreview = () => {
    if (!file) { toast.error("اختر ملف التسويات أولاً"); return; }
    startPreview(async () => {
      const fd = new FormData(); fd.append("file", file);
      const r = await previewAmazonSettlementAction(fd);
      if (!r.ok) { toast.error(r.error); setPreview(null); return; }
      setPreview(r);
    });
  };

  const doImport = () => {
    if (!file || !preview) return;
    startImport(async () => {
      const fd = new FormData(); fd.append("file", file);
      const r = await runAmazonSettlementAction(fd);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`تم: ${r.posted} معاملة مُرحّلة، ${r.imported} جديدة، ${r.deferredHeld} مؤجّلة محفوظة`);
      router.refresh();
      setPreview(null); setFile(null); if (inputRef.current) inputRef.current.value = "";
    });
  };

  const gl = preview?.gl;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>استيراد تسويات أمازون</CardTitle>
          <CardDescription>
            ارفع تقرير المعاملات (Payments → Reports → Transaction view). يُخزّن تفصيل كل طلب ويُرحّل قيداً محاسبياً مجمّعاً
            للمعاملات <b>المُفرج عنها</b> فقط (المبيعات إيراد، والعمولة/FBA رسوم، والصافي على «رصيد أمازون الوسيط»، والتحويلات على البنك).
            المؤجّلة تُحفظ وتُرحّل عند إفراجها. إعادة الرفع لا تُكرّر ولا تُرحّل مرتين.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef} type="file" accept=".csv,.xlsx,.xls"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}
              className="block text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <Button onClick={doPreview} disabled={!file || previewing}>
              {previewing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Eye" className="size-4" />}معاينة
            </Button>
            {preview && (
              <Button onClick={doImport} disabled={importing} className="bg-emerald-600 hover:bg-emerald-700">
                {importing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}
                تنفيذ الاستيراد والترحيل
              </Button>
            )}
          </div>

          {preview && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">إجمالي المعاملات: {preview.total}</Badge>
              <Badge className="bg-emerald-600">جديدة: {preview.newCount}</Badge>
              <Badge variant="default">مُفرج عنها: {preview.released}</Badge>
              <Badge variant="outline">مؤجّلة: {preview.deferred}</Badge>
            </div>
          )}
          {preview && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(preview.byType).map(([t, n]) => (
                <Badge key={t} variant="outline">{TYPE_AR[t] ?? t}: {n}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {gl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">القيد المحاسبي المجمّع (المُفرج عنها)</CardTitle>
            <CardDescription>معاينة الحركة قبل الترحيل — القيد متوازن.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="إيرادات مبيعات أمازون (دائن)" value={gl.revenue} tone="pos" />
              <Row label="رسوم أمازون — عمولة + FBA (مدين)" value={gl.fees} tone="neg" />
              <Row label="تحويلات إلى البنك (مدين)" value={gl.bank} tone="pos" />
              <Row label="صافي رصيد أمازون الوسيط" value={gl.clearing} tone={gl.clearing >= 0 ? "pos" : "neg"} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone: "pos" | "neg" }) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${tone === "neg" ? "text-destructive" : "text-foreground"}`}>{fmt(value)}</span>
    </div>
  );
}
