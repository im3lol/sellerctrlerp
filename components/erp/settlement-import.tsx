"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { previewAmazonSettlementAction, runAmazonSettlementAction, postAmazonSettlementsAction, reverseAmazonSettlementAction, setAmazonGoLiveAction, type SettlementPreview } from "@/app/actions/erp/amazon-settlement";
import { syncSettlementsAction, settlementsSyncStatusAction } from "@/app/actions/erp/marketplace-sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPE_AR: Record<string, string> = {
  Order: "طلبات", Refund: "مرتجعات", Transfer: "تحويلات بنكية",
  "Service Fee": "رسوم خدمة", "SAFE-T reimbursement": "تعويضات SAFE-T", "FBA Inventory Fee": "رسوم مخزون FBA",
};

export type SettlementRow = { id: string; type: string; orderId: string | null; sku: string | null; total: number; status: string; posted: boolean };

export function SettlementImport({ code, rows = [], unpostedReleased = 0 }: { code?: string; rows?: SettlementRow[]; unpostedReleased?: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Extract<SettlementPreview, { ok: true }> | null>(null);
  const [previewing, startPreview] = useTransition();
  const [importing, startImport] = useTransition();
  const [posting, startPost] = useTransition();
  const [reversing, startReverse] = useTransition();

  const reversePosting = () => {
    if (!confirm("عكس ترحيل كل قيود تسوية أمازون المرحّلة؟ سيُعاد بناؤها على مستوى كل طلب عند الترحيل التالي، وتُستعاد أرصدة العملاء والفواتير.")) return;
    startReverse(async () => {
      const r = await reverseAmazonSettlementAction();
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.reversed ? `تم عكس ${r.reversed} قيد تسوية — أعد الترحيل الآن` : "لا توجد قيود تسوية مرحّلة لعكسها");
      router.refresh();
    });
  };

  // ── SP-API pull ──
  const [pulling, setPulling] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const pull = () => {
    if (!code || pulling) return;
    setPulling(true);
    void (async () => {
      const r = await syncSettlementsAction(code);
      if (!r.ok) { toast.error(r.error); setPulling(false); return; }
      // Poll the background job until it finishes (settlement report download is slow).
      let ticks = 0;
      timer.current = setInterval(async () => {
        ticks++;
        const st = await settlementsSyncStatusAction(code);
        if (st.phase === "done" || st.phase === "error" || ticks > 40) {
          if (timer.current) clearInterval(timer.current);
          setPulling(false);
          if (st.phase === "error") toast.error(st.error ?? "فشل سحب المدفوعات");
          else toast.success(`تم السحب: ${st.imported ?? 0} معاملة جديدة${st.posted ? `، ${st.posted} مُرحّلة` : ""}`);
          router.refresh();
        }
      }, 3000);
    })();
  };

  const postPulled = () => {
    startPost(async () => {
      const r = await postAmazonSettlementsAction();
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`تم ترحيل ${r.posted} معاملة${r.perOrderEntries ? ` (${r.perOrderEntries} قيد لكل طلب)` : ""}${r.returnsCreated ? `، ${r.returnsCreated} مرتجع` : ""}${r.deferredHeld ? `، ${r.deferredHeld} مؤجّلة محفوظة` : ""}`);
      if (r.returnsUnmatched.length) toast.warning(`مرتجعات لم تُطابَق (${r.returnsUnmatched.length})`, { duration: 10000 });
      if (r.heldForImport) toast.warning(`${r.heldForImport} معاملة محجوزة — طلباتها غير مستوردة (لن تمسّ الذمم حتى تُستورد)`, { duration: 10000 });
      router.refresh();
    });
  };

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
      toast.success(`تم: ${r.posted} معاملة مُرحّلة${r.perOrderEntries ? ` (${r.perOrderEntries} قيد لكل طلب)` : ""}، ${r.imported} جديدة، ${r.deferredHeld} مؤجّلة محفوظة${r.returnsCreated ? `، ${r.returnsCreated} مرتجع` : ""}`);
      if (r.returnsUnmatched.length) {
        toast.warning(`مرتجعات لم تُطابَق (${r.returnsUnmatched.length}): ${r.returnsUnmatched.slice(0, 5).join("؛ ")}${r.returnsUnmatched.length > 5 ? " …" : ""}`, { duration: 12000 });
      }
      if (r.heldForImport) toast.warning(`${r.heldForImport} معاملة محجوزة — طلباتها غير مستوردة (لن تمسّ الذمم حتى تُستورد)`, { duration: 10000 });
      router.refresh();
      setPreview(null); setFile(null); if (inputRef.current) inputRef.current.value = "";
    });
  };

  // ── Go-Live: start date + Amazon wallet opening balance ──
  const [goLiveDate, setGoLiveDate] = useState<string>("");
  const [walletBalance, setWalletBalance] = useState<string>("");
  const [savingGoLive, startGoLive] = useTransition();
  const saveGoLive = () => {
    if (!goLiveDate) { toast.error("اختر تاريخ بدء الربط"); return; }
    startGoLive(async () => {
      const r = await setAmazonGoLiveAction(goLiveDate, Number(walletBalance) || 0);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success("تم تفعيل بدء الربط — التسويات الأقدم من التاريخ لن تُرحّل، وسُجّل الرصيد الافتتاحي للمحفظة");
      router.refresh();
    });
  };

  const gl = preview?.gl;
  return (
    <div className="space-y-6">
      {/* Go-Live: accounting start date + wallet opening balance */}
      <Card>
        <CardHeader>
          <CardTitle>بدء الربط المحاسبي (Go-Live)</CardTitle>
          <CardDescription>
            حدّد تاريخ بدء المحاسبة على أمازون + رصيد أمازون المتاح وقت التشغيل. المعاملات الأقدم من التاريخ
            تُعتبر تاريخية (لا تُرحّل — يغطّيها الرصيد الافتتاحي)، فلا تظهر محفظة أمازون سالبة بسبب تحويلات
            تخصّ طلبات قبل التشغيل. اضبطها مرة واحدة عند أول تفعيل.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="goLiveDate">تاريخ بدء الربط</Label>
              <Input id="goLiveDate" type="date" value={goLiveDate} onChange={(e) => setGoLiveDate(e.target.value)} className="w-44" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="walletBalance">رصيد أمازون المتاح وقت التشغيل</Label>
              <Input id="walletBalance" type="number" step="0.01" min="0" value={walletBalance} onChange={(e) => setWalletBalance(e.target.value)} placeholder="0.00" dir="ltr" className="w-44" />
            </div>
            <Button onClick={saveGoLive} disabled={savingGoLive} variant="outline">
              {savingGoLive ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Flag" className="size-4" />}
              تفعيل بدء الربط
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SP-API automatic pull */}
      <Card>
        <CardHeader>
          <CardTitle>سحب المدفوعات من أمازون</CardTitle>
          <CardDescription>
            يسحب تقارير التسويات مباشرة من أمازون (SP-API) — تفاصيل الطلبات + التحويلات البنكية + الرسوم/العمولات.
            التقارير تُصدرها أمازون كل ~أسبوعين عند إقفال فترة تسوية. الترحيل المحاسبي حسب إعداد المنصة
            (تلقائي أو مراجعة يدوية). إعادة السحب لا تُكرّر (منع تكرار بالمفتاح الفريد).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={pull} disabled={!code || pulling}>
              {pulling ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Download" className="size-4" />}
              {pulling ? "جارٍ السحب…" : "اسحب المدفوعات الآن"}
            </Button>
            {unpostedReleased > 0 && (
              <Button onClick={postPulled} disabled={posting} className="bg-emerald-600 hover:bg-emerald-700">
                {posting ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}
                ترحيل المعاملات المسحوبة ({unpostedReleased})
              </Button>
            )}
            <Button onClick={reversePosting} disabled={reversing} variant="outline" title="يعكس قيود التسوية المرحّلة ويعيد الأرصدة، ثم أعد الترحيل ليُبنى على مستوى كل طلب">
              {reversing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Undo2" className="size-4" />}
              عكس ترحيل التسوية
            </Button>
          </div>

          {rows.length > 0 && (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">النوع</TableHead>
                    <TableHead className="text-start">الطلب / SKU</TableHead>
                    <TableHead className="w-32 text-start">الإجمالي</TableHead>
                    <TableHead className="w-28 text-start">الحالة</TableHead>
                    <TableHead className="w-24 text-start">الترحيل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{TYPE_AR[r.type] ?? r.type}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.orderId || "—"}{r.sku ? <span className="ms-2 font-mono text-xs">{r.sku}</span> : null}
                      </TableCell>
                      <TableCell className={`tabular-nums ${r.total < 0 ? "text-destructive" : ""}`}>{fmt(r.total)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "Released" ? "default" : "outline"}>{r.status === "Released" ? "مُفرج عنها" : "مؤجّلة"}</Badge>
                      </TableCell>
                      <TableCell>
                        {r.posted ? <Badge className="bg-emerald-600">مُرحّلة</Badge> : <Badge variant="secondary">غير مُرحّلة</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual XLSX upload (fallback / historical) */}
      <Card>
        <CardHeader>
          <CardTitle>استيراد يدوي من ملف (اختياري)</CardTitle>
          <CardDescription>
            بديل للسحب التلقائي: ارفع تقرير المعاملات (Payments → Reports → Transaction view). يُخزّن تفصيل كل طلب
            ويُرحّل قيداً محاسبياً مجمّعاً للمعاملات <b>المُفرج عنها</b> فقط. الإيراد يُعترف به مرة عند فاتورة البيع؛
            التسوية <b>تُحصّل ذمم أمازون</b> فقط، وتُسجّل العمولة/FBA رسوماً، والصافي على «رصيد أمازون الوسيط»، والتحويلات على البنك.
            كل صف <b>Refund</b> يُنشئ دورة مرتجع كاملة. المؤجّلة تُحفظ وتُرحّل عند إفراجها. إعادة الرفع لا تُكرّر.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef} type="file" accept=".csv,.xlsx,.xls"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}
              className="block text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <Button onClick={doPreview} disabled={!file || previewing} variant="outline">
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
              <Row label="تحصيل ذمم أمازون (دائن)" value={gl.receivable} tone="pos" />
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
