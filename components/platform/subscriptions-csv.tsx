"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerRow } from "@/lib/erp/platform-data";

const money = (n: number) => n.toFixed(2);

export function SubscriptionsCsvExport({ customers }: { customers: CustomerRow[] }) {
  const download = () => {
    const header = ["الاسم", "الحالة", "الدورة", "الخطة", "السعر", "MRR", "بداية الاشتراك", "انتهاء الاشتراك", "متبقي (يوم)", "الموديولات"].join(",");
    const rows = customers.map((c) => {
      const mrr = c.interval === "MONTHLY" ? c.price : c.interval === "ANNUAL" ? c.price / 12 : 0;
      return [
        `"${c.name}"`,
        c.status,
        c.interval ?? "",
        `"${c.planName ?? ""}"`,
        money(c.price),
        money(mrr),
        c.startedAt ? new Date(c.startedAt).toLocaleDateString("en-GB") : "",
        c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-GB") : "",
        c.daysLeft ?? "",
        `"${c.modules.join("|")}"`,
      ].join(",");
    });
    const csv = "﻿" + [header, ...rows].join("\n"); // BOM for Excel Arabic
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download className="size-4" /> تصدير CSV
    </Button>
  );
}
