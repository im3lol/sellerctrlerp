import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Field } from "@/components/erp/document-detail";
import { ItemDetailActions } from "@/components/erp/item-detail-actions";

const money = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId, role } = await requireErpModule("inventory.view");

  const [item] = await db.select().from(items).where(and(eq(items.id, id), eq(items.organizationId, orgId))).limit(1);
  if (!item) notFound();

  const codes = await db.select({ codeType: itemCodes.codeType, code: itemCodes.code }).from(itemCodes).where(eq(itemCodes.itemId, item.id));

  // On-hand per warehouse (latest balance).
  const stockRows = (await db.execute<{ wid: string; q: string; v: string }>(sql`
    SELECT DISTINCT ON (warehouse_id) warehouse_id wid, balance_quantity q, balance_value v
    FROM stock_movements WHERE organization_id = ${orgId} AND item_id = ${item.id}
    ORDER BY warehouse_id, created_at DESC, id DESC
  `)).rows as { wid: string; q: string; v: string }[];
  const whs = await db.select({ id: warehouses.id, name: warehouses.nameAr }).from(warehouses).where(eq(warehouses.organizationId, orgId));
  const whName = new Map(whs.map((w) => [w.id, w.name]));
  const totalQty = stockRows.reduce((s, r) => s + Number(r.q), 0);
  const totalVal = stockRows.reduce((s, r) => s + Number(r.v), 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Package"
        title={item.nameAr ?? item.code}
        subtitle={`الكود: ${item.code}`}
        backHref="/erp/inventory/items"
        action={<ItemDetailActions itemId={item.id} canEdit={erpCan(role, "inventory.edit")} canDelete={erpCan(role, "inventory.delete")} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-4">
            <div className="aspect-square w-full overflow-hidden rounded-xl border bg-muted/40">
              {item.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={item.image} alt={item.nameAr ?? item.code} className="size-full object-cover" />
                : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-12" /></div>}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم">{item.nameAr ?? "—"}</Field>
            <Field label="الاسم بالإنجليزية">{item.nameEn ?? "—"}</Field>
            <Field label="سعر البيع">{money(item.sellPrice)}</Field>
            <Field label="حد إعادة الطلب">{qf(item.minStock)}</Field>
            <Field label="المتاح الكلي">{qf(totalQty)}</Field>
            <Field label="قيمة المخزون">{money(totalVal)}</Field>
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
    </div>
  );
}
