import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, suppliers } from "@/db/schema";
import { receiptLineCosts } from "@/lib/erp/receipt-cost";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { accountBalances } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reconcile "بضاعة لم تُفوتر" (2103) against the receipts that haven't been billed yet.
 * The receipt credits 2103 and the invoice debits it, so the account should hold exactly
 * the value of confirmed-but-unbilled receipts. A difference means a posting bug or a
 * credit note raised without the matching physical return. Big ERPs reconcile GR/IR
 * monthly for the same reason. Read-only.
 */
export default async function GrniReconciliationPage() {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    // Confirmed receipts still awaiting an invoice — these are what 2103 should hold.
    const openReceipts = await db
      .select({ id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, purchaseOrderId: purchaseReceipts.purchaseOrderId, warehouseId: purchaseReceipts.warehouseId, supplier: suppliers.nameAr })
      .from(purchaseReceipts)
      .leftJoin(suppliers, eq(suppliers.id, purchaseReceipts.supplierId))
      .where(and(eq(purchaseReceipts.organizationId, orgId), eq(purchaseReceipts.status, "RECEIVED")));

    // One shared definition of what a receipt capitalised — the same helper the invoice's
    // three-way match uses, so this report can never disagree with the posting.
    const values = await Promise.all(
      openReceipts.map(async (r) => {
        const lines = await receiptLineCosts(db, r);
        return [r.id, round2(lines.reduce((s, l) => s + l.value, 0))] as const;
      }),
    );
    const valueByReceipt = new Map(values);

    const rows = openReceipts
      .map((r) => ({ ...r, value: valueByReceipt.get(r.id) ?? 0 }))
      .filter((r) => Math.abs(r.value) > 0.004)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const expected = round2(rows.reduce((s, r) => s + r.value, 0));

    const [accMap, balances] = await Promise.all([resolveAccountIds(orgId, ["2103"]), accountBalances({ orgId })]);
    const grniAccountId = accMap["2103"];
    const grniAccount = grniAccountId ? balances.find((b) => b.id === grniAccountId) : undefined;
    // 2103 is a LIABILITY (credit-normal); accountBalances returns debit − credit.
    const glValue = round2(-(grniAccount?.balance ?? 0));
    const diff = round2(glValue - expected);
    const matched = Math.abs(diff) < 0.01;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Scale" title="مطابقة بضاعة لم تُفوتر" subtitle="رصيد حساب ٢١٠٣ مقابل إذون الاستلام غير المفوترة" backHref="/purchases" />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">قيمة الإذون غير المفوترة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(expected)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">رصيد الحساب (GL)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(glValue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">الفرق</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${matched ? "text-emerald-600" : "text-destructive"}`}>{fmt(diff)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>النتيجة</CardTitle>
              <CardDescription>
                {grniAccount
                  ? `حساب ${grniAccount.code} — ${grniAccount.nameAr}. الاستلام يدائن الحساب والفاتورة تمدينه، فالرصيد يجب أن يساوي قيمة الإذون التي لم تُفوتر بعد.`
                  : "لم يُضبط حساب «بضاعة لم تُفوتر» (2103) في دليل الحسابات."}
              </CardDescription>
            </div>
            <Badge variant={matched ? "default" : "destructive"} className="text-sm">{matched ? "مطابَق" : "غير مطابَق"}</Badge>
          </CardHeader>
          <CardContent>
            {matched ? (
              <p className="text-sm text-muted-foreground">الحساب مطابق تماماً لإذون الاستلام المعلّقة.</p>
            ) : (
              <p className="text-sm text-destructive">
                يوجد فرق قدره {fmt(Math.abs(diff))}. الأسباب المعتادة: إشعار مدين على فاتورة بدون مرتجع فعلي للبضاعة (أو العكس)، أو قيد يدوي على الحساب.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>إذون استلام بانتظار الفوترة</CardTitle>
            <CardDescription>بضاعة دخلت المخزون ولم تصل فاتورتها بعد — هذه هي مكوّنات الرصيد.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">كل إذون الاستلام مفوترة.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الإذن</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">المورد</TableHead>
                    <TableHead className="text-start">القيمة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/purchases/receipts/${encodeURIComponent(r.number)}`} className="font-mono text-sm text-primary hover:underline">{r.number}</Link>
                      </TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.supplier ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{fmt(r.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
