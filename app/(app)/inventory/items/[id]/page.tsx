import { notFound } from "next/navigation";
import { and, eq, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Field } from "@/components/erp/document-detail";
import { getAvailability } from "@/lib/erp/availability";
import { getItemFamily } from "@/lib/erp/item-family";
import { getItemPnl, getItemLinkedDocs } from "@/lib/erp/item-pnl";
import Link from "next/link";
import { ItemDetailActions } from "@/components/erp/item-detail-actions";
import { ItemFamilyManager } from "@/components/erp/item-family-manager";
import { BarcodePrintButton, type PrintCode } from "@/components/erp/barcode-print";

const money = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // URL carries the item CODE; old UUID links still resolve. ponytail: a code
  // with a literal "/" would split the segment — none in use; encode on links.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return loadErpPage("inventory.view", async ({ orgId, role, can }) => {
    const [item] = await db.select().from(items)
      .where(and(eq(items.organizationId, orgId), isUuid ? or(eq(items.id, id), eq(items.code, id)) : eq(items.code, id)))
      .limit(1);
    if (!item) notFound();

    const codes = await db.select({ codeType: itemCodes.codeType, code: itemCodes.code }).from(itemCodes).where(eq(itemCodes.itemId, item.id));

    // On-hand per warehouse (latest balance).
    const stockRows = (await db.execute<{ wid: string; q: string; v: string }>(sql`
      SELECT DISTINCT ON (warehouse_id) warehouse_id wid, balance_quantity q, balance_value v
      FROM stock_movements WHERE organization_id = ${orgId} AND item_id = ${item.id}
      ORDER BY warehouse_id, created_at DESC, number DESC
    `)).rows as { wid: string; q: string; v: string }[];
    const whs = await db.select({ id: warehouses.id, name: warehouses.nameAr }).from(warehouses).where(eq(warehouses.organizationId, orgId));
    const whName = new Map(whs.map((w) => [w.id, w.name]));
    const totalQty = stockRows.reduce((s, r) => s + Number(r.q), 0);
    const totalVal = stockRows.reduce((s, r) => s + Number(r.v), 0);
    const av = (await getAvailability(orgId, [item.id])).get(item.id);
    const family = await getItemFamily(orgId, item);
    const canSeePnl = can("reports.view");
    const [pnl, linkedDocs] = canSeePnl
      ? await Promise.all([getItemPnl(orgId, item.id, item.code), getItemLinkedDocs(orgId, item.id)])
      : [null, []];
    const ldt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

    // Printable codes: the item code + every linked platform/identifier code (SKU,
    // ASIN, FNSKU, UPC/EAN, …), deduped by value — the label the seller picks from.
    const CODE_LABEL: Record<string, string> = { SKU: "SKU (كود المنصة)", ASIN: "ASIN", FNSKU: "FNSKU", UPC: "UPC", EAN: "EAN", NOON: "كود نون" };
    const printCodes: PrintCode[] = [];
    const seenCode = new Set<string>();
    const pushCode = (label: string, value: string | null | undefined) => {
      const v = (value ?? "").trim();
      if (!v || seenCode.has(v)) return;
      seenCode.add(v);
      printCodes.push({ label, value: v });
    };
    pushCode("كود الصنف", item.code);
    for (const c of codes) pushCode(CODE_LABEL[c.codeType] ?? c.codeType, c.code);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Package"
          title={item.nameAr ?? item.code}
          subtitle={`الكود: ${item.code}`}
          backHref="/inventory/items"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <BarcodePrintButton itemName={item.nameAr ?? item.code} codes={printCodes} />
              <ItemDetailActions itemId={item.id} canEdit={can("inventory.edit")} canDelete={can("inventory.delete")} />
            </div>
          }
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardContent className="p-4">
              <div className="aspect-square w-full overflow-hidden rounded-xl border bg-muted/40">
                {item.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={item.image} alt={item.nameAr ?? item.code} className="size-full object-contain" />
                  : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-12" /></div>}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم">{item.nameAr ?? "—"}</Field>
              <Field label="سعر البيع">{money(item.sellPrice)}</Field>
              <Field label="حد إعادة الطلب">{qf(item.minStock)}</Field>
              <Field label="الرصيد الكلي">{qf(totalQty)}</Field>
              <Field label="محجوز لأوامر">{qf(av?.reserved ?? 0)}</Field>
              <Field label="المتاح للبيع"><span className={(av?.available ?? totalQty) <= 0 ? "text-destructive font-semibold" : "font-semibold"}>{qf(av?.available ?? totalQty)}</span></Field>
              <Field label="قيمة المخزون">{money(totalVal)}</Field>
              {item.brand && <Field label="العلامة التجارية">{item.brand}</Field>}
              {item.weight && <Field label="الوزن">{item.weight}</Field>}
              {item.dimensions && <Field label="الأبعاد">{item.dimensions}</Field>}
            </div>

            <Card>
              <CardHeader><CardTitle>الأكواد</CardTitle><CardDescription>الباركود والأكواد الخارجية المرتبطة بالصنف.</CardDescription></CardHeader>
              <CardContent>
                {codes.length === 0 ? (
                  <div className="py-3 text-sm text-muted-foreground">لا توجد أكواد. أضِفها من «تعديل».</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {codes.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm">
                        <Badge variant="secondary">{c.codeType}</Badge><span className="font-mono">{c.code}</span>
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {(family || (!item.parentItemId && can("inventory.edit"))) && (
          <ItemFamilyManager
            currentItemId={item.id}
            isChild={!!item.parentItemId}
            canEdit={can("inventory.edit")}
            head={family?.head ?? null}
            variations={family?.children ?? []}
          />
        )}

        {item.description && (
          <Card>
            <CardHeader><CardTitle>الوصف</CardTitle></CardHeader>
            <CardContent><p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{item.description}</p></CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>الرصيد حسب المستودع</CardTitle></CardHeader>
          <CardContent>
            {stockRows.length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">لا توجد حركة مخزون لهذا الصنف.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">المستودع</TableHead>
                    <TableHead className="text-start">الكمية</TableHead>
                    <TableHead className="text-start">القيمة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockRows.map((r) => (
                    <TableRow key={r.wid}>
                      <TableCell>{whName.get(r.wid) ?? "—"}</TableCell>
                      <TableCell>{qf(r.q)}</TableCell>
                      <TableCell>{money(r.v)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {pnl && (
          <Card>
            <CardHeader>
              <CardTitle>الربحية (P&L)</CardTitle>
              <CardDescription>
                إيراد وتكلفة الصنف من فواتير البيع المرحّلة، ورسوم أمازون الفعلية من التسويات.
                {!pnl.hasSettlement && " (لا توجد تسويات أمازون لهذا الصنف بعد — الرسوم صفر.)"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="الكمية المباعة">{qf(pnl.units)}</Field>
                <Field label="المبيعات">{money(pnl.revenue)}</Field>
                <Field label="عمولة أمازون">{money(pnl.referralFee)}</Field>
                <Field label="رسوم FBA">{money(pnl.fbaFee)}</Field>
                <Field label="تكلفة البضاعة">{money(pnl.cogs)}</Field>
                <Field label="صافي الربح">
                  <span className={pnl.net < 0 ? "font-bold text-destructive" : "font-bold text-emerald-600"}>{money(pnl.net)}</span>
                  <span className="ms-2 text-xs text-muted-foreground">({pnl.margin.toFixed(1)}%)</span>
                </Field>
              </div>
              {pnl.otherFee !== 0 && <p className="mt-3 text-xs text-muted-foreground">رسوم أمازون أخرى: {money(pnl.otherFee)} · إجمالي رسوم أمازون: {money(pnl.amazonFees)}</p>}
            </CardContent>
          </Card>
        )}

        {pnl && linkedDocs.length > 0 && (
          <Card>
            <CardHeader><CardTitle>المستندات المرتبطة</CardTitle><CardDescription>كل مستند لمس هذا الصنف — بيع وشراء ومرتجعات.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">النوع</TableHead>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">الكمية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedDocs.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant="secondary">{d.kind}</Badge></TableCell>
                      <TableCell className="font-mono"><Link href={d.href} className="text-primary hover:underline">{d.number}</Link></TableCell>
                      <TableCell>{ldt(d.date)}</TableCell>
                      <TableCell className="tabular-nums">{qf(d.qty)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  });
}
