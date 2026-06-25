import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { paymentVouchers, paymentLines, suppliers, purchaseInvoices, accounts, organizations } from "@/db/schema";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

const METHOD: Record<string, string> = {
  CASH: "نقدًا", BANK: "تحويل بنكي", CHECK: "شيك", CARD: "بطاقة",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintPaymentVoucherPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("purchases.view");

  const [pv] = await db
    .select()
    .from(paymentVouchers)
    .where(and(eq(paymentVouchers.number, raw), eq(paymentVouchers.organizationId, orgId)))
    .limit(1);
  if (!pv) notFound();

  const [org] = await db
    .select({ nameAr: organizations.nameAr, address: organizations.address, phone: organizations.phone, taxNumber: organizations.taxNumber })
    .from(organizations).where(eq(organizations.id, orgId));

  const [supp] = pv.supplierId
    ? await db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
        .from(suppliers).where(eq(suppliers.id, pv.supplierId)).limit(1)
    : [undefined];

  const [cashAcc] = pv.cashAccountId
    ? await db.select({ nameAr: accounts.nameAr }).from(accounts).where(eq(accounts.id, pv.cashAccountId)).limit(1)
    : [undefined];

  const lines = await db
    .select({
      amount: paymentLines.amount,
      invNumber: purchaseInvoices.number,
      invDate: purchaseInvoices.date,
      invTotal: purchaseInvoices.totalAmount,
    })
    .from(paymentLines)
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, paymentLines.purchaseInvoiceId))
    .where(eq(paymentLines.paymentVoucherId, pv.id));

  const amountInWords = toArabicWords(Number(pv.amount));

  return (
    <>
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', 'Noto Sans Arabic', sans-serif; font-size: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 6px 10px; border: 1px solid #e5e7eb; }
        thead { background: #f9fafb; }
      `}</style>

      <div className="no-print fixed top-4 start-4 z-50 flex gap-2">
        <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow">طباعة</button>
        <a href={`/erp/purchases/payments/${encodeURIComponent(raw)}`} className="rounded border px-4 py-2 text-sm font-medium shadow hover:bg-muted">رجوع</a>
      </div>

      <div className="mx-auto max-w-[800px] p-8 print:p-0">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between border-b-2 pb-6">
          <div>
            <h1 className="text-2xl font-bold">{org?.nameAr}</h1>
            {org?.address   && <p className="text-sm text-gray-600">{org.address}</p>}
            {org?.phone     && <p className="text-sm text-gray-600">هاتف: {org.phone}</p>}
            {org?.taxNumber && <p className="text-sm text-gray-600">الرقم الضريبي: {org.taxNumber}</p>}
          </div>
          <div className="text-end">
            <p className="text-lg font-bold text-gray-700">سند صرف</p>
            <p className="mt-1 text-2xl font-mono font-bold text-primary">{pv.number}</p>
            <p className="mt-1 text-sm text-gray-500">التاريخ: {dt(pv.date)}</p>
          </div>
        </div>

        {/* Amount box */}
        <div className="mb-6 rounded-xl border-2 border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950/20">
          <p className="text-xs text-gray-500">إجمالي المبلغ المدفوع</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-red-700 dark:text-red-400">{fmt(pv.amount)}</p>
          {amountInWords && <p className="mt-1 text-sm text-gray-600">{amountInWords}</p>}
        </div>

        {/* Supplier + Payment method */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">المورّد</p>
            <p className="mt-1 font-semibold">{supp?.nameAr ?? "—"}</p>
            {supp?.phone   && <p className="text-sm text-gray-600">هاتف: {supp.phone}</p>}
            {supp?.address && <p className="text-sm text-gray-600">{supp.address}</p>}
          </div>
          <div className="rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">طريقة الدفع</p>
            <p className="mt-1 font-semibold">{METHOD[pv.paymentMethod] ?? pv.paymentMethod}</p>
            {cashAcc   && <p className="text-sm text-gray-600">الحساب: {cashAcc.nameAr}</p>}
            {pv.reference && <p className="text-sm text-gray-600">المرجع: {pv.reference}</p>}
          </div>
        </div>

        {/* Invoice lines */}
        {lines.length > 0 && (
          <table className="mb-6 text-sm">
            <thead>
              <tr>
                <th className="text-start">رقم الفاتورة</th>
                <th className="text-center">التاريخ</th>
                <th className="text-end">إجمالي الفاتورة</th>
                <th className="text-end">المبلغ المدفوع</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="font-mono">{l.invNumber ?? "—"}</td>
                  <td className="text-center">{l.invDate ? dt(l.invDate) : "—"}</td>
                  <td className="text-end tabular-nums">{fmt(l.invTotal)}</td>
                  <td className="text-end tabular-nums font-semibold">{fmt(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pv.notes && (
          <div className="mb-6 rounded-lg border p-3 text-sm text-gray-700">
            <p className="font-medium">ملاحظات:</p>
            <p>{pv.notes}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-3 gap-8 text-sm text-gray-500">
          {["إعداد", "اعتماد", "المورّد / المستلم"].map((label) => (
            <div key={label} className="text-center">
              <div className="mb-2 h-10 border-b border-gray-300" />
              <p>{label}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function toArabicWords(n: number): string {
  const ones = ["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة","عشرة","أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
  const tens = ["","","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
  if (n === 0) return "صفر";
  if (n >= 1000000) return `${toArabicWords(Math.floor(n / 1000000))} مليون ${toArabicWords(n % 1000000)}`.trim();
  if (n >= 1000) return `${toArabicWords(Math.floor(n / 1000))} ألف ${toArabicWords(n % 1000)}`.trim();
  if (n >= 100) return `${ones[Math.floor(n / 100)]} مئة ${toArabicWords(n % 100)}`.trim();
  if (n < 20) return ones[n] ?? "";
  const ten = Math.floor(n / 10), one = n % 10;
  return one ? `${ones[one]} و${tens[ten]}` : tens[ten] ?? "";
}
