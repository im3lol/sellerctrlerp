"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { toast } from "@/lib/i18n/toast";
import { findSerialAction } from "@/app/actions/erp/serials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";

type Hit = NonNullable<Awaited<ReturnType<typeof findSerialAction>>["hits"]>[number];

const tone = (s: string) =>
  s === "IN_STOCK" ? "secondary" : s === "SOLD" ? "outline" : s === "SCRAPPED" ? "destructive" : "outline";

/**
 * Look one serial up. Scan or type it — the match ignores hyphens, spaces and case, so
 * a number read off a label finds the same unit as one pasted from a spreadsheet.
 */
export function SerialLookup() {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [pending, start] = useTransition();

  const search = () => {
    const query = q.trim();
    if (!query) return;
    start(async () => {
      const r = await findSerialAction(query);
      if (!r.ok) { toast.error(r.error ?? t("تعذّر البحث")); return; }
      setHits(r.hits ?? []);
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("ابحث برقم تسلسلي")}</CardTitle>
          <CardDescription>{t("البحث بيتجاهل الشرطات والمسافات وحالة الحروف — امسح الباركود أو اكتبه.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-sm font-mono" dir="ltr" autoFocus
              placeholder="SN-0001"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            />
            <Button onClick={search} disabled={pending || !q.trim()}>
              <Icon name="Search" className="size-4" />بحث
            </Button>
          </div>
        </CardContent>
      </Card>

      {hits !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{t("النتيجة")}</CardTitle>
            <CardDescription>{hits.length ? `${hits.length} قطعة` : "مفيش قطعة بالرقم ده"}</CardDescription>
          </CardHeader>
          <CardContent>
            {hits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("الرقم ده مش مسجّل. لو القطعة اتستلمت من غير ما يتسجّل رقمها، هتلاقيها في المخزون بالكمية بس.")}
              </p>
            ) : (
              <div className="rounded-xl border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t("الرقم")}</TableHead>
                      <TableHead className="text-start">{t("الصنف")}</TableHead>
                      <TableHead className="text-start">{t("الحالة")}</TableHead>
                      <TableHead className="text-start">{t("المخزن")}</TableHead>
                      <TableHead className="text-start">{t("دخل بإذن")}</TableHead>
                      <TableHead className="text-start">{t("خرج بإذن")}</TableHead>
                      <TableHead className="text-start">{t("العميل")}</TableHead>
                      <TableHead className="text-start">{t("التواريخ")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hits.map((h) => (
                      <TableRow key={`${h.itemCode}-${h.serial}`}>
                        <TableCell className="font-mono text-xs" dir="ltr">{h.serial}</TableCell>
                        <TableCell>
                          <div className="font-medium">{h.itemName}</div>
                          <div className="font-mono text-xs text-muted-foreground" dir="ltr">{h.itemCode}</div>
                        </TableCell>
                        <TableCell><Badge variant={tone(h.status)}>{h.statusLabel}</Badge></TableCell>
                        <TableCell>{h.warehouse ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{h.receiptNumber ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{h.deliveryNumber ?? "—"}</TableCell>
                        <TableCell>{h.customerName ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground" dir="ltr">
                          {h.receivedAt ?? "—"}{h.soldAt ? ` ← ${h.soldAt}` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
