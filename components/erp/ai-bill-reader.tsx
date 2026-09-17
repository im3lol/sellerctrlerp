"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { readBillAction, billToInvoiceAction, billToExpenseAction, type ReadBillResult } from "@/app/actions/erp/ai-bills";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Account = { id: string; code: string; name: string };
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }));
const KIND: Record<string, string> = { goods: "فاتورة بضاعة", services: "فاتورة خدمة", receipt: "إيصال" };

/**
 * Upload → read → review → one click to a DRAFT. Nothing is created by the read itself;
 * the person sees what came back (and what doesn't add up) and chooses what it becomes.
 */
export function AiBillReader({ canInvoice, canExpense, expenseAccounts, cashAccounts }: {
  canInvoice: boolean; canExpense: boolean; expenseAccounts: Account[]; cashAccounts: Account[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ReadBillResult | null>(null);
  const [receiptId, setReceiptId] = useState("");
  const [expenseAcc, setExpenseAcc] = useState<{ id: string; label: string } | null>(null);
  const [cashAcc, setCashAcc] = useState(cashAccounts[0]?.id ?? "");
  const label = (a: Account) => `${a.code} — ${a.name}`;

  const read = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const r = await readBillAction(fd);
      if (!r.ok) { toast.error(r.error ?? "تعذّرت القراءة"); return; }
      setRes(r);
      setReceiptId(r.receipts?.[0]?.id ?? "");
    });
  };

  const toInvoice = () => start(async () => {
    const r = await billToInvoiceAction(res!.captureId!, receiptId);
    if (!r.ok || !r.number) { toast.error(r.error ?? "تعذّر إنشاء الفاتورة"); return; }
    toast.success(`فاتورة شراء مسودة ${r.number}${r.unmatched ? ` — ${r.unmatched} بند ماتطابقش، راجع أسعاره` : ""}`);
    router.push(`/purchases/invoices/${encodeURIComponent(r.number)}`);
  });

  const toExpense = () => start(async () => {
    const r = await billToExpenseAction(res!.captureId!, { expenseAccountId: expenseAcc!.id, cashAccountId: cashAcc });
    if (!r.ok) { toast.error(r.error ?? "تعذّر إنشاء المصروف"); return; }
    toast.success(`مصروف مسودة ${r.number ?? ""}`);
    router.push(r.number ? `/accounting/expenses/${encodeURIComponent(r.number)}/edit` : "/accounting/expenses");
  });

  const b = res?.bill;
  const goodsFirst = b?.kind === "goods";

  const invoiceCard = canInvoice && b && (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">فاتورة شراء من إذن الاستلام</CardTitle>
        <CardDescription>بضاعة استلمتها: الفاتورة بتتعمل من الإذن، وأسعارها من فاتورة المورد. الكميات زي ما اتستلمت.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        {!res?.supplier ? (
          <p className="text-sm text-muted-foreground">المورد «{b.supplierName ?? "؟"}» مش موجود عندك — ضيفه، واستلم البضاعة بإذن استلام، وبعدين اقرا الفاتورة تاني.</p>
        ) : (res.receipts ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">مفيش إذن استلام مفتوح لـ«{res.supplier.nameAr}» — استلم البضاعة الأول (أمر شراء ← إذن استلام).</p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="grn">إذن الاستلام</Label>
              <select id="grn" className={`${selectCls} w-64`} value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
                {res.receipts!.map((r) => <option key={r.id} value={r.id}>{r.number} — {r.date}</option>)}
              </select>
            </div>
            <Button disabled={pending || !receiptId} onClick={toInvoice}><Icon name="FileText" className="size-4" />اعمل فاتورة شراء مسودة</Button>
          </>
        )}
      </CardContent>
    </Card>
  );

  const expenseCard = canExpense && b && (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">مصروف</CardTitle>
        <CardDescription>خدمة أو إيصال (إيجار، كهربا، شحن، ضيافة…): مصروف مسودة بالمبلغ والتاريخ ورقم الفاتورة.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-2">
        <div className="w-72 space-y-2">
          <Label>بند المصروف</Label>
          <CellCombobox selectedLabel={expenseAcc?.label ?? ""} placeholder="اختار بند المصروف"
            options={expenseAccounts.map((a) => ({ id: a.id, label: label(a) }))}
            onSelect={(id, l) => setExpenseAcc({ id, label: l })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash">اتدفع من</Label>
          <select id="cash" className={`${selectCls} w-56`} value={cashAcc} onChange={(e) => setCashAcc(e.target.value)}>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </select>
        </div>
        <Button variant={goodsFirst ? "outline" : "default"} disabled={pending || !expenseAcc || !cashAcc} onClick={toExpense}>
          <Icon name="Wallet" className="size-4" />اعمل مصروف مسودة
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>ارفع الفاتورة</CardTitle>
          <CardDescription>
            PDF أو صورة واضحة. الملف ده بس هو اللي بيتبعت للذكاء الاصطناعي — مفيش أي بيانات تانية من حسابك —
            ومفيش أي مستند بيتعمل غير لما تدوس بنفسك.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="max-w-sm"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} />
          <Button disabled={!file || pending} onClick={read}>
            {pending ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Sparkles" className="size-4" />}
            اقرأ الفاتورة
          </Button>
        </CardContent>
      </Card>

      {b && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">اللي اتقرا</CardTitle>
              <Badge variant="outline">{KIND[b.kind] ?? b.kind}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">المورد</dt><dd className="font-medium">
                {b.supplierName ?? "—"}
                {res?.supplier ? <span className="ms-1 text-xs text-emerald-600">✓ {res.supplier.nameAr}</span> : <span className="ms-1 text-xs text-amber-600">(مش عندك)</span>}
              </dd></div>
              <div><dt className="text-xs text-muted-foreground">رقم الفاتورة</dt><dd className="font-mono">{b.invoiceNumber ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">التاريخ</dt><dd>{b.invoiceDate ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">الإجمالي</dt><dd className="font-bold tabular-nums">{num(b.total)} {b.currency ?? ""}</dd></div>
            </dl>

            {(res?.warnings ?? []).length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                {res!.warnings!.map((w, i) => <li key={i} className="flex gap-2"><Icon name="TriangleAlert" className="mt-0.5 size-4 shrink-0" />{w}</li>)}
              </ul>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">البند</TableHead>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">الكمية</TableHead>
                    <TableHead className="text-start">السعر</TableHead>
                    <TableHead className="text-start">الضريبة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-[280px] truncate" title={l.description}>{l.description}</TableCell>
                      <TableCell className="font-mono text-xs">{l.code ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{num(l.quantity)}</TableCell>
                      <TableCell className="tabular-nums">{num(l.unitPrice)}</TableCell>
                      <TableCell className="tabular-nums">{l.taxRate != null ? `${num(l.taxRate)}٪` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              قبل الضريبة {num(b.subtotal)} · الضريبة {num(b.tax)} · الإجمالي {num(b.total)} — المستند اللي هيتعمل مسودة، تقدر تعدّله قبل الترحيل.
            </p>
          </CardContent>
        </Card>
      )}

      {b && (goodsFirst ? <>{invoiceCard}{expenseCard}</> : <>{expenseCard}{invoiceCard}</>)}
    </div>
  );
}
