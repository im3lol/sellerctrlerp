"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });

type Run = {
  id: string;
  number: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  totalGross: string;
  totalNet: string;
  postedAt: Date | null;
};

const statusLabel: Record<string, string> = {
  DRAFT: "مسودة",
  POSTED: "مرحَّل",
  REVERSED: "معكوس",
};

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  DRAFT: "secondary",
  POSTED: "default",
  REVERSED: "destructive",
};

export function PayrollRunsList({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
        <FileText className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm">لا توجد مسيرات رواتب بعد</p>
        <Link href="/erp/hr/payroll/new" className="mt-2 inline-block text-sm text-primary hover:underline">
          إنشاء أول مسير
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr className="[&>th]:p-3 [&>th]:text-start">
            <th>رقم المسير</th>
            <th>الفترة</th>
            <th>إجمالي المرتبات</th>
            <th>صافي المدفوعات</th>
            <th>الحالة</th>
            <th>تاريخ الترحيل</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t [&>td]:p-3 [&>td]:align-middle">
              <td className="font-mono text-xs font-medium">{r.number}</td>
              <td className="text-xs">
                {new Date(r.periodStart).toLocaleDateString("ar-EG")}
                {" — "}
                {new Date(r.periodEnd).toLocaleDateString("ar-EG")}
              </td>
              <td className="tabular-nums">{money(r.totalGross)}</td>
              <td className="tabular-nums font-medium">{money(r.totalNet)}</td>
              <td>
                <Badge variant={statusVariant[r.status] ?? "secondary"} className="text-xs">
                  {statusLabel[r.status] ?? r.status}
                </Badge>
              </td>
              <td className="text-xs text-muted-foreground">
                {r.postedAt ? new Date(r.postedAt).toLocaleDateString("ar-EG") : "—"}
              </td>
              <td>
                <Link
                  href={`/erp/hr/payroll/${r.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  عرض
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
