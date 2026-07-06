"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { previewAmazonCodeLinkAction, saveAmazonCodeLinksAction, type SkuLinkRow } from "@/app/actions/erp/amazon-codes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { CellCombobox } from "@/components/erp/cell-combobox";

type Preview = { rows: SkuLinkRow[]; items: { id: string; label: string }[]; alreadyLinked: number; totalSkus: number };

export function SkuLinker() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({}); // sku → itemId
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();

  const labelById = useMemo(() => new Map((preview?.items ?? []).map((o) => [o.id, o.label])), [preview]);
  const chosenCount = useMemo(() => Object.values(chosen).filter(Boolean).length, [chosen]);
  const autoCount = useMemo(() => (preview?.rows ?? []).filter((r) => r.autoItemId).length, [preview]);

  const doPreview = () => {
    if (!file) { toast.error("اختر ملف أمازون أولاً"); return; }
    startPreview(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await previewAmazonCodeLinkAction(fd);
      if (!r.ok) { toast.error(r.error); setPreview(null); return; }
      setPreview(r);
      // Pre-fill auto-matched suggestions.
      const init: Record<string, string> = {};
      for (const row of r.rows) if (row.autoItemId) init[row.sku] = row.autoItemId;
      setChosen(init);
      if (r.rows.length === 0) toast.success("كل أكواد الملف مربوطة بالفعل 🎉");
    });
  };

  const doSave = () => {
    if (!preview || chosenCount === 0) return;
    const links = preview.rows
      .filter((r) => chosen[r.sku])
      .map((r) => ({ sku: r.sku, asin: r.asin, itemId: chosen[r.sku] }));
    startSave(async () => {
      const r = await saveAmazonCodeLinksAction(links);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(`تم ربط ${r.linked} صنف`);
      // Drop the just-linked rows from the table.
      setPreview((p) => p ? { ...p, rows: p.rows.filter((row) => !chosen[row.sku]), alreadyLinked: p.alreadyLinked + r.linked } : p);
      setChosen({});
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>ربط أكواد أمازون بالأصناف</CardTitle>
          <CardDescription>
            ارفع تقرير طلبات أمازون لاستخراج أكواد SKU/ASIN غير المربوطة. الأصناف التي يطابق كودها الداخلي الـ SKU تُقترح تلقائياً؛
            راجع/عدّل الاختيار ثم احفظ. بعد الربط ستنجح مطابقة استيراد الطلبات.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setChosen({}); }}
              className="block text-sm file:me-3 file:rounded-md file:border file:border-input file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <Button onClick={doPreview} disabled={!file || previewing}>
              {previewing ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Eye" className="size-4" />}
              فحص الأكواد
            </Button>
            {preview && preview.rows.length > 0 && (
              <Button onClick={doSave} disabled={saving || chosenCount === 0} className="bg-emerald-600 hover:bg-emerald-700">
                {saving ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Link" className="size-4" />}
                حفظ الروابط ({chosenCount})
              </Button>
            )}
          </div>

          {preview && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">إجمالي الأكواد: {preview.totalSkus}</Badge>
              <Badge className="bg-emerald-600">مربوطة سابقاً: {preview.alreadyLinked}</Badge>
              <Badge variant="destructive">غير مربوطة: {preview.rows.length}</Badge>
              {autoCount > 0 && <Badge variant="outline">مُقترح تلقائياً: {autoCount}</Badge>}
              <Link href="/erp/sales/orders/import" className="ms-auto text-primary hover:underline">→ العودة لاستيراد الطلبات</Link>
            </div>
          )}
        </CardContent>
      </Card>

      {preview && preview.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">أكواد بحاجة لربط ({preview.rows.length})</CardTitle>
            <CardDescription>اختر الصنف المقابل لكل كود. اترك أي صف فارغاً لتجاهله الآن.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">SKU</TableHead>
                  <TableHead className="text-start">ASIN</TableHead>
                  <TableHead className="text-start">المنتج (أمازون)</TableHead>
                  <TableHead className="text-start min-w-64">الصنف في النظام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.sku}>
                    <TableCell className="font-mono text-xs" dir="ltr">{r.sku}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">{r.asin}</TableCell>
                    <TableCell className="max-w-xs truncate" title={r.productName}>{r.productName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <CellCombobox
                          selectedLabel={chosen[r.sku] ? labelById.get(chosen[r.sku]) ?? "" : ""}
                          options={preview.items}
                          onSelect={(id) => setChosen((c) => ({ ...c, [r.sku]: id }))}
                          placeholder="ابحث عن الصنف…"
                        />
                        {r.autoItemId && chosen[r.sku] === r.autoItemId && <Badge variant="outline" className="shrink-0 text-[10px]">تلقائي</Badge>}
                        {chosen[r.sku] && (
                          <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setChosen((c) => { const n = { ...c }; delete n[r.sku]; return n; })} aria-label="مسح">
                            <Icon name="X" className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
