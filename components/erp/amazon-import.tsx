"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { previewAmazonImportAction, runAmazonImportAction, type AmazonPreview, type ImportResult } from "@/app/actions/erp/amazon-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");
const STATUS_AR: Record<string, string> = { Pending: "قيد الانتظار → مسودة", Shipped: "مشحون → مؤكّد" };

export function AmazonImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Extract<AmazonPreview, { ok: true }> | null>(null);
  const [previewing, startPreview] = useTransition();
  const [importing, startImport] = useTransition();
  const [result, setResult] = useState<Extract<ImportResult, { ok: true }> | null>(null);

  const reset = () => { setPreview(null); setResult(null); };

  const doPreview = () => {
    if (!file) { toast.error("اختر ملف الطلبات أولاً"); return; }
    startPreview(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await previewAmazonImportAction(fd);
      if (!r.ok) { toast.error(r.error); setPreview(null); return; }
      setPreview(r);
      if (r.toCreate.length === 0) toast.message("لا توجد طلبات جديدة قابلة للإنشاء — راجع التقرير أدناه");
    });
  };

  const doImport = () => {
    if (!file || !preview || (preview.toCreate.length === 0 && preview.transitions.length === 0)) return;
    startImport(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await runAmazonImportAction(fd);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`تم: ${r.created} أمر جديد، ${r.fulfilled} دورة كاملة (صرف+فاتورة)، ${r.transitioned} حالة محدّثة`);
      if (r.stockBlocked.length) toast.warning(`${r.stockBlocked.length} طلب محظور لنقص مخزون — راجع التقرير`, { duration: 8000 });
      setPreview(null); setResult(r); router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>استيراد طلبات أمازون</CardTitle>
          <CardDescription>
            ارفع تقرير الطلبات (Order Report) من Amazon Seller Central. كل طلب يُنشأ أمر بيع مستقل تحت عميل «أمازون مصر»
            ومخزن «أمازون FBA». الطلبات المشحونة → أمر مؤكّد + إذن صرف + فاتورة بيع تلقائياً؛ المعلّقة تبقى مسودة؛ والمعلّق الذي اكتمل يُحدَّث ويأخذ الدورة.
            الملغاة تُتجاهل، وإعادة الرفع لا تُكرّر. أي طلب ينقص مخزونه يُدرَج في تقرير (بلا حركة مخزون خاطئة).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
              className="block text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <Button onClick={doPreview} disabled={!file || previewing}>
              {previewing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Eye" className="size-4" />}
              معاينة
            </Button>
            {preview && (preview.toCreate.length > 0 || preview.transitions.length > 0) && (
              <Button variant="default" onClick={doImport} disabled={importing} className="bg-emerald-600 hover:bg-emerald-700">
                {importing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}
                تنفيذ الاستيراد والدورة ({preview.toCreate.length + preview.transitions.length})
              </Button>
            )}
          </div>

          {preview && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge className="bg-emerald-600">سيُنشأ: {preview.toCreate.length}</Badge>
              {preview.transitions.length > 0 && <Badge className="bg-sky-600">تحديث حالة (معلّق→مكتمل): {preview.transitions.length}</Badge>}
              <Badge variant="secondary">مكرّر (مستورد سابقاً): {preview.duplicates.length}</Badge>
              <Badge variant="destructive">محظور (صنف غير مربوط): {preview.blocked.length}</Badge>
              <Badge variant="outline">ملغاة متجاهَلة: {preview.cancelledCount}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader><CardTitle className="text-base">نتيجة الاستيراد</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge className="bg-emerald-600">أوامر جديدة: {result.created}</Badge>
              <Badge className="bg-sky-600">دورة كاملة (صرف+فاتورة): {result.fulfilled}</Badge>
              <Badge variant="secondary">حالة محدّثة: {result.transitioned}</Badge>
              <Badge variant="outline">مكرّر: {result.skippedDuplicate}</Badge>
              {result.failed > 0 && <Badge variant="destructive">فشل: {result.failed}</Badge>}
            </div>
            {result.stockBlocked.length > 0 && (
              <div className="rounded-lg border border-amber-400/50 bg-amber-50/50 p-3">
                <p className="mb-2 text-sm font-medium text-amber-700">طلبات محظورة لنقص مخزون ({result.stockBlocked.length}) — أُنشئت كأوامر مؤكّدة بلا صرف؛ وفّر المخزون ثم أعد الرفع:</p>
                <ul className="space-y-1 text-xs">
                  {result.stockBlocked.slice(0, 50).map((b) => (
                    <li key={b.orderId} className="flex gap-2"><span className="font-mono" dir="ltr">{b.orderId}</span><span className="text-muted-foreground">— {b.reason}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview && preview.unmatched.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">أصناف غير مربوطة ({preview.unmatched.length})</CardTitle>
            <CardDescription>
              هذه الأكواد (SKU) غير مرتبطة بأي صنف في النظام، فطلباتها لن تُستورد. اربط الأكواد بالأصناف دفعة واحدة من الأداة أدناه، ثم أعد رفع الملف.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">SKU</TableHead>
                  <TableHead className="text-start">ASIN</TableHead>
                  <TableHead className="text-start">المنتج</TableHead>
                  <TableHead className="text-start">مثال طلب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.unmatched.map((u) => (
                  <TableRow key={u.sku}>
                    <TableCell className="font-mono" dir="ltr">{u.sku}</TableCell>
                    <TableCell className="font-mono" dir="ltr">{u.asin}</TableCell>
                    <TableCell className="max-w-md truncate" title={u.productName}>{u.productName}</TableCell>
                    <TableCell className="font-mono text-muted-foreground" dir="ltr">{u.sampleOrder}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4">
              <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
                <Link href="/erp/sales/orders/import/link"><Icon name="Link" className="size-4" />اربط الأكواد بالأصناف</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && preview.toCreate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">طلبات ستُنشأ ({preview.toCreate.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">رقم الطلب</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="text-start">الأصناف</TableHead>
                  <TableHead className="text-start">الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.toCreate.slice(0, 100).map((o) => (
                  <TableRow key={o.orderId}>
                    <TableCell className="font-mono text-xs" dir="ltr">{o.orderId}</TableCell>
                    <TableCell>{dt(o.date)}</TableCell>
                    <TableCell><Badge variant={o.status === "Shipped" ? "default" : "secondary"}>{STATUS_AR[o.status] ?? o.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.lines.map((l) => `${l.itemName ?? l.sku} ×${l.qty}`).join("، ")}</TableCell>
                    <TableCell>{fmt(o.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {preview.toCreate.length > 100 && (
              <p className="mt-2 text-xs text-muted-foreground">تُعرض أول 100 طلب فقط — سيُستورد الكل ({preview.toCreate.length}).</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
