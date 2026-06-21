import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const money = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ItemsPage() {
  const { orgId, role } = await requireErpModule("inventory.view");
  const canManage = erpCan(role, "inventory.create");

  const rows = await db
    .select({
      id: items.id, code: items.code, nameAr: items.nameAr, image: items.image,
      sellPrice: items.sellPrice, isActive: items.isActive,
      codeCount: sql<number>`count(${itemCodes.id})`,
    })
    .from(items)
    .leftJoin(itemCodes, eq(itemCodes.itemId, items.id))
    .where(eq(items.organizationId, orgId))
    .groupBy(items.id)
    .orderBy(asc(items.code));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Package"
        title="الأصناف"
        subtitle={`${rows.length} صنف`}
        backHref="/erp/inventory"
        action={canManage ? (
          <Button asChild><Link href="/erp/inventory/items/new"><Icon name="Plus" className="size-4" />صنف جديد</Link></Button>
        ) : undefined}
      />
      <Card>
        <CardHeader><CardTitle>قائمة الأصناف</CardTitle><CardDescription>الأصناف وأكوادها وأسعارها — اضغط الصنف لعرض تفاصيله.</CardDescription></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد أصناف بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start w-14">الصورة</TableHead>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="text-start">الاسم</TableHead>
                  <TableHead className="text-start">الأكواد</TableHead>
                  <TableHead className="text-start">سعر البيع</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="size-9 overflow-hidden rounded-md border bg-muted/40">
                        {r.image
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={r.image} alt="" className="size-full object-cover" />
                          : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-4" /></div>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">
                      <Link href={`/erp/inventory/items/${r.id}`} className="text-primary underline">{r.code}</Link>
                    </TableCell>
                    <TableCell>{r.nameAr ?? "—"}</TableCell>
                    <TableCell>{Number(r.codeCount) > 0 ? <Badge variant="secondary">{Number(r.codeCount).toLocaleString("ar-EG-u-nu-latn")}</Badge> : "—"}</TableCell>
                    <TableCell>{money(r.sellPrice)}</TableCell>
                    <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "نشط" : "متوقف"}</Badge></TableCell>
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
