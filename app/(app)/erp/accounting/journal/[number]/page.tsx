import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines, accounts, costCenters } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { JournalEntryActions } from "@/components/erp/journal-entry-actions";

const fmt = (v: string | number | null) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّل", variant: "default" },
  REVERSED: { label: "معكوس", variant: "destructive" },
};
const SOURCE: Record<string, string> = {
  MANUAL: "قيد يدوي",
  SALES_INVOICE: "فاتورة بيع",
  PURCHASE_INVOICE: "فاتورة شراء",
  REVERSAL: "قيد عكسي",
};

export default async function JournalEntryDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId, role } = await requireErpModule("accounting.view");

  // Public URLs use the readable document number; old UUID links redirect to it.
  if (UUID_RE.test(raw)) {
    const [byId] = await db
      .select({ number: journalEntries.number })
      .from(journalEntries)
      .where(and(eq(journalEntries.id, raw), eq(journalEntries.organizationId, orgId)))
      .limit(1);
    if (!byId) notFound();
    redirect(`/erp/accounting/journal/${encodeURIComponent(byId.number)}`);
  }

  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.number, raw), eq(journalEntries.organizationId, orgId)))
    .limit(1);
  if (!entry) notFound();

  const lines = await db
    .select({
      id: journalEntryLines.id,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      description: journalEntryLines.description,
      accountCode: accounts.code,
      accountName: accounts.nameAr,
      costCenterName: costCenters.nameAr,
    })
    .from(journalEntryLines)
    .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
    .leftJoin(costCenters, eq(costCenters.id, journalEntryLines.costCenterId))
    .where(eq(journalEntryLines.journalEntryId, entry.id));

  let reversalNumber: string | null = null;
  if (entry.status === "REVERSED" && entry.reversedById) {
    const [rev] = await db.select({ number: journalEntries.number }).from(journalEntries).where(eq(journalEntries.id, entry.reversedById)).limit(1);
    reversalNumber = rev?.number ?? null;
  }

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  const st = STATUS[entry.status] ?? { label: entry.status, variant: "secondary" as const };
  const isReversal = entry.sourceType === "REVERSAL";
  const hasCostCenters = lines.some((l) => l.costCenterName);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BookText"
        title={`قيد ${entry.number}`}
        subtitle={SOURCE[entry.sourceType ?? ""] ?? "قيد محاسبي"}
        backHref="/erp/accounting/journal"
        action={
          <JournalEntryActions
            entryId={entry.id}
            status={entry.status}
            isReversal={isReversal}
            canPost={erpCan(role, "accounting.post")}
            canReverse={erpCan(role, "accounting.reverse")}
            canDelete={erpCan(role, "accounting.create")}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="الحالة"><Badge variant={st.variant}>{st.label}</Badge></Field>
        <Field label="التاريخ">{dt(entry.date)}</Field>
        <Field label="المرجع">{entry.reference || "—"}</Field>
        <Field label="البيان">{entry.description || "—"}</Field>
      </div>

      {entry.status === "REVERSED" && reversalNumber && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          هذا القيد معكوس.{" "}
          <Link href={`/erp/accounting/journal/${encodeURIComponent(reversalNumber)}`} className="font-medium text-primary underline">
            عرض القيد العكسي ({reversalNumber})
          </Link>
          {entry.reversalReason ? ` — السبب: ${entry.reversalReason}` : ""}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>البنود</CardTitle>
          <CardDescription>تفاصيل أطراف القيد.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الحساب</TableHead>
                <TableHead className="text-start">البيان</TableHead>
                {hasCostCenters && <TableHead className="text-start">مركز التكلفة</TableHead>}
                <TableHead className="text-start">مدين</TableHead>
                <TableHead className="text-start">دائن</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <span className="font-mono">{l.accountCode}</span> — {l.accountName}
                  </TableCell>
                  <TableCell>{l.description || "—"}</TableCell>
                  {hasCostCenters && <TableCell>{l.costCenterName || "—"}</TableCell>}
                  <TableCell>{Number(l.debit) ? fmt(l.debit) : "—"}</TableCell>
                  <TableCell>{Number(l.credit) ? fmt(l.credit) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={hasCostCenters ? 3 : 2}>الإجمالي</TableCell>
                <TableCell>{fmt(totalDebit)}</TableCell>
                <TableCell>{fmt(totalCredit)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}
