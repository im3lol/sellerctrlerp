import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { expenseClaims, expenseClaimLines, accounts } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ExpenseClaimRowActions } from "@/components/erp/expense-claim-row-actions";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ExpenseClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const [claim] = await db.select({ id: expenseClaims.id, number: expenseClaims.number, date: expenseClaims.date, employee: expenseClaims.employeeName, status: expenseClaims.status, notes: expenseClaims.notes, cashName: accounts.nameAr })
      .from(expenseClaims).leftJoin(accounts, eq(accounts.id, expenseClaims.cashAccountId))
      .where(and(eq(expenseClaims.id, id), eq(expenseClaims.organizationId, orgId))).limit(1);
    if (!claim) notFound();

    const lines = await db.select({ acc: accounts.nameAr, code: accounts.code, amount: expenseClaimLines.amount, description: expenseClaimLines.description })
      .from(expenseClaimLines).innerJoin(accounts, eq(accounts.id, expenseClaimLines.expenseAccountId))
      .where(eq(expenseClaimLines.claimId, id));
    const total = lines.reduce((s, l) => s + Number(l.amount), 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ReceiptText" title={`مطالبة ${claim.number}`} subtitle={`${claim.employee} · ${dt(claim.date)} · التعويض من ${claim.cashName ?? "—"}`} backHref="/hr/expense-claims"
          action={<ExpenseClaimRowActions id={claim.id} status={claim.status} canManage={can("accounting.post")} />} />
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>بنود المصروف</CardTitle><Badge variant={claim.status === "APPROVED" ? "default" : "secondary"}>{claim.status === "APPROVED" ? "معتمد" : "مسودة"}</Badge></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead className="text-start">البند</TableHead><TableHead className="text-start">وصف</TableHead><TableHead className="text-end">المبلغ</TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.acc}</TableCell>
                    <TableCell className="max-w-[320px] truncate text-sm text-muted-foreground" title={l.description ?? undefined}>{l.description ?? "—"}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{fmt(Number(l.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end text-base font-bold text-primary">الإجمالي: {fmt(total)}</div>
            {claim.notes && <p className="mt-3 text-sm text-muted-foreground">ملاحظات: {claim.notes}</p>}
          </CardContent>
        </Card>
      </div>
    );
  });
}
