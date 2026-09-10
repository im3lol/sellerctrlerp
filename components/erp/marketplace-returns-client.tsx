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
import type { ReturnCondition, NotReceivedReason } from "@/lib/erp/return-disposition";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (s: string) => new Date(s).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

type Warehouse = { id: string; name: string };

/**
 * What was in the box. "Damaged" is not one thing: a dented BOX still sells, a scratched
 * or opened or used unit is real stock that just can't be sold as new, and a destroyed
 * one is worth nothing and must never enter a warehouse.
 */
const CONDITIONS: { key: ReturnCondition; label: string; effect: string; tone: string }[] = [
  { key: "SELLABLE", label: "سليم", effect: "يرجع للمخزون القابل للبيع", tone: "text-emerald-600" },
  { key: "PACKAGING_DAMAGED", label: "العبوة تالفة والمنتج سليم", effect: "يرجع للمخزون القابل للبيع", tone: "text-emerald-600" },
  { key: "OPENED", label: "مفتوح", effect: "يرجع للمخزون بس مش للبيع كجديد", tone: "text-amber-600" },
  { key: "SCRATCHED", label: "مخربش", effect: "يرجع للمخزون بس مش للبيع كجديد", tone: "text-amber-600" },
  { key: "USED", label: "مستخدم", effect: "يرجع للمخزون بس مش للبيع كجديد", tone: "text-amber-600" },
  { key: "DESTROYED", label: "تالف خالص", effect: "إعدام — مايدخلش أي مخزن", tone: "text-destructive" },
];

/** Nothing came back — and which of these it was decides the claim you can make. */
const REASONS: { key: NotReceivedReason; label: string }[] = [
  { key: "NEVER_ARRIVED", label: "مرجعش أصلاً" },
  { key: "WRONG_ITEM", label: "رجع منتج مختلف" },
  { key: "SHORT_QUANTITY", label: "رجعت كمية أقل" },
];

/** Conditions that keep the unit off sale but still in stock — these need a destination. */
const NEEDS_WAREHOUSE = new Set<ReturnCondition>(["OPENED", "SCRATCHED", "USED"]);

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

  // Per-row decision state. Nothing is sent until the trader presses تأكيد, because
  // every one of these outcomes is irreversible once it posts.
  const [cond, setCond] = useState<Record<string, ReturnCondition | "">>({});
  const [reason, setReason] = useState<Record<string, NotReceivedReason>>({});
  const [qty, setQty] = useState<Record<string, string>>({});

  const confirm = (o: MarketplaceReturnRow) => start(async () => {
    setBusy(o.id);
    const c = cond[o.id];
    const r = await confirmPlatformReturnAction(o.id, c
      ? { kind: "RECEIVED", condition: c, quantity: qty[o.id] ? Number(qty[o.id]) : null, warehouseId: dest[o.id] || null }
      : { kind: "NOT_RECEIVED", reason: reason[o.id] ?? "NEVER_ARRIVED" });
    if ("error" in r) toast.error(r.error, { duration: 8000 });
    else { setRows((rs) => rs.filter((x) => x.id !== o.id)); toast.success("تمّ الترحيل على الفاتورة والمخزون والطلب"); }
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
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CONDITIONS.map((c) => (
              <div key={c.key} className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <PackageCheck className={`mt-0.5 size-4 shrink-0 ${c.tone}`} />
                <span><b>{c.label}</b> — {c.effect}</span>
              </div>
            ))}
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <HandCoins className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span><b>ماستلمتوش</b> — عكس الفاتورة بس، مفيش مخزون، في انتظار تعويض</span>
            </div>
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
                      <TableCell className="min-w-[280px]">
                        <select
                          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                          value={cond[o.id] ?? ""}
                          onChange={(e) => setCond((d) => ({ ...d, [o.id]: e.target.value as ReturnCondition | "" }))}
                        >
                          <option value="">ماستلمتوش</option>
                          {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>

                        {/* Nothing came back: which of these decides the claim you can make. */}
                        {!cond[o.id] && (
                          <select
                            className="mt-1.5 h-8 w-full rounded-md border bg-background px-2 text-xs"
                            value={reason[o.id] ?? "NEVER_ARRIVED"}
                            onChange={(e) => setReason((d) => ({ ...d, [o.id]: e.target.value as NotReceivedReason }))}
                          >
                            {REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                          </select>
                        )}

                        {/* Real stock, just not sellable as new — it needs somewhere to go. */}
                        {cond[o.id] && NEEDS_WAREHOUSE.has(cond[o.id] as ReturnCondition) && warehouses.length > 0 && (
                          <select
                            className="mt-1.5 h-8 w-full rounded-md border bg-background px-2 text-xs"
                            value={dest[o.id] ?? ""}
                            onChange={(e) => setDest((d) => ({ ...d, [o.id]: e.target.value }))}
                          >
                            <option value="">الوجهة: الافتراضي (مخزن التوالف أو إعدام)</option>
                            {warehouses.map((w) => <option key={w.id} value={w.id}>→ {w.name}</option>)}
                          </select>
                        )}

                        {/* Fewer units in the box than were billed — credit only those. */}
                        {cond[o.id] && (
                          <Input
                            type="number" step="any" min="0" max={totalQty}
                            className="mt-1.5 h-8 text-xs"
                            placeholder={`الكمية المستلمة (${qtyf(totalQty)})`}
                            value={qty[o.id] ?? ""}
                            onChange={(e) => setQty((d) => ({ ...d, [o.id]: e.target.value }))}
                          />
                        )}

                        <Button size="sm" className="mt-2 w-full" disabled={isBusy} onClick={() => confirm(o)}>
                          {isBusy ? <Loader2 className="size-4 animate-spin" /> : <PackageX className="size-4" />}
                          تأكيد
                        </Button>
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
