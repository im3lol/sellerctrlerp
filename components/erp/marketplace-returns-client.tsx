"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, PackageCheck, PackageX, HandCoins, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemThumb } from "@/components/erp/item-thumb";
import { confirmPlatformReturnAction, type MarketplaceReturnRow } from "@/app/actions/erp/platform-returns";
import type { ReturnReceipt } from "@/lib/erp/return-disposition";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (s: string) => new Date(s).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

type Warehouse = { id: string; name: string };

/** The three decisions, with what each one actually does spelled out. */
const CHOICES: { key: ReturnReceipt; label: string; hint: string; icon: typeof PackageCheck; tone: string }[] = [
  { key: "RECEIVED_SELLABLE", label: "سليم", hint: "عكس الفاتورة + رجوع للمخزون القابل للبيع", icon: PackageCheck, tone: "text-emerald-600" },
  { key: "RECEIVED_DAMAGED", label: "تالف", hint: "عكس الفاتورة + البضاعة تتحط في المخزن اللي تختاره أو تتعدم", icon: PackageX, tone: "text-amber-600" },
  { key: "NOT_RECEIVED", label: "ماستلمتوش", hint: "عكس الفاتورة بس — مفيش مخزون، في انتظار تعويض", icon: HandCoins, tone: "text-muted-foreground" },
];

/**
 * Marketplace customer returns awaiting a receipt decision.
 *
 * A return isn't real until the goods are back, so nothing posts until the trader says
 * what arrived. The damaged destination is chosen per return rather than fixed: the same
 * product can be worth restocking one week and worth writing off the next, and only the
 * person holding it knows which.
 */
export function MarketplaceReturnsClient({ initial, warehouses }: { initial: MarketplaceReturnRow[]; warehouses: Warehouse[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Destination per return, only consulted for the damaged choice. "" = the org default
  // (its damaged warehouse, or a write-off when it has none).
  const [dest, setDest] = useState<Record<string, string>>({});

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => [r.number, r.externalReturnId, r.invoiceNumber, r.customerName, r.itemsSummary]
      .some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [rows, q]);

  const act = (id: string, receipt: ReturnReceipt) => start(async () => {
    setBusy(id);
    const r = await confirmPlatformReturnAction(id, receipt, receipt === "RECEIVED_DAMAGED" ? (dest[id] || null) : null);
    if ("error" in r) toast.error(r.error, { duration: 8000 });
    else { setRows((rs) => rs.filter((x) => x.id !== id)); toast.success("تمّ الترحيل على الفاتورة والمخزون والطلب"); }
    setBusy(null);
  });

  if (rows.length === 0) {
    return <Card><CardContent className="py-14 text-center text-muted-foreground">مفيش مرتجعات منصات مستنية مراجعة ✓</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm text-muted-foreground">
            دي مرتجعات عملاء من المنصات، لسه <b>مسودّات</b>. العميل بيرجّع للمنصة، والمنصة مش دايماً بتبعتهالك — فمفيش حاجة بتترحّل لحد ما تقول إيه اللي وصلك بالظبط.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {CHOICES.map((c) => (
              <div key={c.key} className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <c.icon className={`mt-0.5 size-4 shrink-0 ${c.tone}`} />
                <span><b>{c.label}</b> — {c.hint}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث برقم المرتجع أو الطلب أو الفاتورة أو الصنف…" className="ps-9" />
      </div>

      <Card>
        <CardContent className="pt-6">
          {shown.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">مفيش نتائج للبحث ده.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 text-start">صورة</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المرتجع</TableHead>
                  <TableHead className="text-end">الكمية</TableHead>
                  <TableHead className="text-end">القيمة</TableHead>
                  <TableHead className="text-start">قرار الاستلام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((o) => {
                  const isBusy = pending && busy === o.id;
                  const first = o.items[0];
                  const more = o.items.length - 1;
                  const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
                  return (
                    <TableRow key={o.id} className={isBusy ? "opacity-60" : undefined}>
                      <TableCell className="w-14"><ItemThumb src={first?.image ?? null} /></TableCell>
                      <TableCell className="max-w-[280px] whitespace-normal">
                        <div className="line-clamp-2 leading-snug" title={o.itemsSummary}>{first?.name ?? first?.code ?? "—"}</div>
                        {first?.code && <div className="font-mono text-xs text-muted-foreground" dir="ltr">{first.code}</div>}
                        {more > 0 && <div className="text-xs text-muted-foreground">+ {qtyf(more)} صنف آخر</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {o.channel && <Badge variant="secondary">{o.channel}</Badge>}
                          <span className="font-mono text-xs">{o.number}</span>
                        </div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{o.externalReturnId ?? ""}</div>
                        <div className="text-xs text-muted-foreground">
                          {dt(o.date)}{o.invoiceNumber ? ` · فاتورة ${o.invoiceNumber}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{qtyf(totalQty)}</TableCell>
                      <TableCell className="text-end tabular-nums font-medium">{fmt(o.total)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {CHOICES.map((c) => (
                            <Button key={c.key} size="sm" variant="outline" disabled={isBusy}
                              title={c.hint} onClick={() => act(o.id, c.key)}>
                              {isBusy && busy === o.id ? <Loader2 className="size-4 animate-spin" /> : <c.icon className={`size-4 ${c.tone}`} />}
                              {c.label}
                            </Button>
                          ))}
                        </div>
                        {warehouses.length > 0 && (
                          <select
                            className="mt-1.5 h-8 w-full rounded-md border bg-background px-2 text-xs"
                            value={dest[o.id] ?? ""}
                            onChange={(e) => setDest((d) => ({ ...d, [o.id]: e.target.value }))}
                            title="وجهة البضاعة التالفة"
                          >
                            <option value="">التالف: الافتراضي (مخزن التوالف أو إعدام)</option>
                            {warehouses.map((w) => <option key={w.id} value={w.id}>التالف → {w.name}</option>)}
                          </select>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
