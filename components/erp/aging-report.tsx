"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type InvoiceRow = {
  id: string;
  number: string;
  date: Date;
  dueDate: Date | null;
  balanceDue: string;
  totalAmount: string;
  partyName: string;
  partyCode: string;
};

const fmt = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 });

const BUCKETS = [
  { label: "حالية (لم تستحق)", max: 0 },
  { label: "1–30 يوم",          min: 1,  max: 30  },
  { label: "31–60 يوم",         min: 31, max: 60  },
  { label: "61–90 يوم",         min: 61, max: 90  },
  { label: "+90 يوم",           min: 91            },
] as const;

function daysPastDue(dueDate: Date | null, today: Date): number {
  if (!dueDate) return 0;
  const diff = Math.floor((today.getTime() - new Date(dueDate).getTime()) / 86400000);
  return diff; // negative = not yet due
}

function bucketOf(days: number): number {
  if (days <= 0) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  if (days <= 90) return 3;
  return 4;
}

const BUCKET_VARIANT = ["default", "secondary", "secondary", "destructive", "destructive"] as const;

function AgingTable({
  rows,
  today,
  title,
}: {
  rows: InvoiceRow[];
  today: Date;
  title: string;
}) {
  const enriched = rows.map((r) => {
    const days = daysPastDue(r.dueDate, today);
    return { ...r, days, bucket: bucketOf(days) };
  });

  // Compute bucket totals
  const bucketTotals = BUCKETS.map((_, i) =>
    enriched.filter((r) => r.bucket === i).reduce((s, r) => s + Number(r.balanceDue), 0),
  );
  const grandTotal = bucketTotals.reduce((s, t) => s + t, 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
        لا توجد مستحقات مفتوحة.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary buckets */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {BUCKETS.map((b, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 text-center">
            <p className="text-xs text-muted-foreground">{b.label}</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${i >= 3 ? "text-destructive" : ""}`}>
              {fmt(bucketTotals[i])}
            </p>
            <p className="text-xs text-muted-foreground">
              {enriched.filter((r) => r.bucket === i).length} فاتورة
            </p>
          </div>
        ))}
      </div>

      {/* Grand total */}
      <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3">
        <span className="font-semibold">إجمالي المستحقات</span>
        <span className="text-xl font-bold tabular-nums">{fmt(grandTotal)}</span>
      </div>

      {/* Detail table */}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr className="[&>th]:p-3 [&>th]:text-start">
              <th>{title}</th>
              <th>رقم الفاتورة</th>
              <th>تاريخ الفاتورة</th>
              <th>تاريخ الاستحقاق</th>
              <th>إجمالي الفاتورة</th>
              <th>المتبقي</th>
              <th>التأخير</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((r) => (
              <tr key={r.id} className="border-t [&>td]:p-3 [&>td]:align-middle">
                <td>
                  <div className="font-medium">{r.partyName}</div>
                  <div className="text-xs text-muted-foreground">{r.partyCode}</div>
                </td>
                <td className="font-mono text-xs">{r.number}</td>
                <td className="text-xs">{new Date(r.date).toLocaleDateString("ar-EG")}</td>
                <td className="text-xs">
                  {r.dueDate ? new Date(r.dueDate).toLocaleDateString("ar-EG") : "—"}
                </td>
                <td className="tabular-nums text-xs">{fmt(r.totalAmount)}</td>
                <td className="tabular-nums font-semibold">{fmt(r.balanceDue)}</td>
                <td>
                  <Badge variant={BUCKET_VARIANT[r.bucket]}>
                    {r.days <= 0 ? "لم تستحق" : `${r.days} يوم`}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AgingReport({
  arRows,
  apRows,
  today,
}: {
  arRows: InvoiceRow[];
  apRows: InvoiceRow[];
  today: Date;
}) {
  return (
    <Tabs defaultValue="ar" dir="rtl">
      <TabsList>
        <TabsTrigger value="ar">
          ذمم مدينة (AR)
          {arRows.length > 0 && (
            <Badge variant="secondary" className="ms-2 text-xs">{arRows.length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="ap">
          ذمم دائنة (AP)
          {apRows.length > 0 && (
            <Badge variant="secondary" className="ms-2 text-xs">{apRows.length}</Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ar" className="mt-4">
        <AgingTable rows={arRows} today={today} title="العميل" />
      </TabsContent>
      <TabsContent value="ap" className="mt-4">
        <AgingTable rows={apRows} today={today} title="المورد" />
      </TabsContent>
    </Tabs>
  );
}
