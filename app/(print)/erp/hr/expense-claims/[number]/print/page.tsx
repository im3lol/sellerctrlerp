import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { expenseClaims, expenseClaimLines, accounts } from "@/db/schema";
import { fmt, dt, money, toArabicWords } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { docNumberParam } from "@/lib/erp/doc-route";

type Params = { params: Promise<{ number: string }> };

export default async function PrintExpenseClaimPage({ params }: Params) {
  const raw = (await params).number;
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, expenseClaims,
      { id: expenseClaims.id, number: expenseClaims.number, organizationId: expenseClaims.organizationId }, "/erp/hr/expense-claims", "/print");
    const [claim] = await db
      .select({
        id: expenseClaims.id,
        number: expenseClaims.number,
        date: expenseClaims.date,
        employee: expenseClaims.employeeName,
        status: expenseClaims.status,
        notes: expenseClaims.notes,
        cashName: accounts.nameAr,
      })
      .from(expenseClaims)
      .leftJoin(accounts, eq(accounts.id, expenseClaims.cashAccountId))
      .where(and(eq(expenseClaims.number, number), eq(expenseClaims.organizationId, orgId)))
      .limit(1);
    if (!claim) notFound();

    const [{ org, currency, hiddenFor, footerText }, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({ acc: accounts.nameAr, code: accounts.code, amount: expenseClaimLines.amount, description: expenseClaimLines.description })
        .from(expenseClaimLines)
        .innerJoin(accounts, eq(accounts.id, expenseClaimLines.expenseAccountId))
        .where(eq(expenseClaimLines.claimId, claim.id)),
    ]);
    const total = lines.reduce((s, l) => s + Number(l.amount), 0);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("expense-claim")}
        footerText={footerText}
        title="مطالبة مصروفات"
        number={claim.number}
        backHref={`/hr/expense-claims/${encodeURIComponent(claim.number)}`}
        watermark={claim.status !== "APPROVED" ? "مسودة" : undefined}
        meta={[
          { label: "التاريخ", value: dt(claim.date) },
          { label: "الحالة", value: claim.status === "APPROVED" ? "معتمد" : "مسودة" },
        ]}
        parties={[
          { label: "الموظف", name: claim.employee, lines: [] },
          ...(claim.cashName ? [{ label: "التعويض من", name: claim.cashName, lines: [] }] : []),
        ]}
        columns={[
          { label: "البند", width: "40%" },
          { label: "البيان", width: "35%" },
          { label: "المبلغ", align: "end", width: "25%" },
        ]}
        rows={lines.map((l) => [
          <span key="n">
            <b>{l.acc}</b>
            <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>
          </span>,
          l.description ?? "—",
          <b key="t">{fmt(l.amount)}</b>,
        ])}
        totals={[{ label: "الإجمالي", value: money(total, currency), tone: "strong" as const }]}
        note={`فقط وقدره: ${toArabicWords(total)} جنيهاً مصرياً لا غير${claim.notes ? `\n${claim.notes}` : ""}`}
        signatures={["الموظف", "المحاسب", "المعتمد"]}
      />
    );
  });
}
