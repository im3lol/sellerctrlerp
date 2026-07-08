import Link from "next/link";
import { and, or, asc, count, eq, ilike, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes, itemCategories } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const money = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const PER_PAGE = 20;

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId, role, can } = await requireErpModule("inventory.view");
  const canManage = can("inventory.create");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const fStatus = one(sp.status); // active | inactive | ""
  const fCategory = one(sp.category);
  const fMissing = one(sp.missing); // image | codes | ""
  const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

  const conds = [eq(items.organizationId, orgId)];
  if (q) {
    const norm = normalizeCode(q);
    const codeItemIds = norm
      ? (await db.select({ id: itemCodes.itemId }).from(itemCodes)
          .where(and(eq(itemCodes.organizationId, orgId), ilike(itemCodes.normalizedCode, `%${norm}%`))).limit(200)).map((r) => r.id)
      : [];
    const search = [ilike(items.code, `%${q}%`), ilike(items.nameAr, `%${q}%`), ilike(items.nameEn, `%${q}%`)];
    if (codeItemIds.length) search.push(inArray(items.id, [...new Set(codeItemIds)]));
    conds.push(or(...search)!);
  }
  if (fStatus === "active") conds.push(eq(items.isActive, true));
  if (fStatus === "inactive") conds.push(eq(items.isActive, false));
  if (fCategory) conds.push(eq(items.categoryId, fCategory));
  if (fMissing === "image") conds.push(isNull(items.image));
  if (fMissing === "codes") {
    const withCodes = [...new Set((await db.select({ id: itemCodes.itemId }).from(itemCodes)
      .where(eq(itemCodes.organizationId, orgId))).map((r) => r.id))];
    if (withCodes.length) conds.push(notInArray(items.id, withCodes));
  }
  const where = and(...conds);

  const [cats, [{ total }]] = await Promise.all([
    db.select({ id: itemCategories.id, nameAr: itemCategories.nameAr }).from(itemCategories).where(eq(itemCategories.organizationId, orgId)).orderBy(asc(itemCategories.code)),
    db.select({ total: count() }).from(items).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const safePage = Math.min(page, pages);

  const rows = await db
    .select({
      id: items.id, code: items.code, nameAr: items.nameAr, image: items.image,
      sellPrice: items.sellPrice, isActive: items.isActive,
      codeCount: sql<number>`count(${itemCodes.id})`,
    })
    .from(items)
    .leftJoin(itemCodes, eq(itemCodes.itemId, items.id))
    .where(where)
    .groupBy(items.id)
    .orderBy(asc(items.code))
    .limit(PER_PAGE)
    .offset((safePage - 1) * PER_PAGE);

  const hasFilters = Boolean(q || fStatus || fCategory || fMissing);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (fStatus) u.set("status", fStatus);
    if (fCategory) u.set("category", fCategory);
    if (fMissing) u.set("missing", fMissing);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Package"
        title="الأصناف"
        subtitle={`${total} صنف`}
        backHref="/erp/inventory"
        action={canManage ? (
          <Button asChild><Link href="/erp/inventory/items/new"><Icon name="Plus" className="size-4" />صنف جديد</Link></Button>
        ) : undefined}
      />
      <Card>
        <CardHeader><CardTitle>قائمة الأصناف</CardTitle><CardDescription>ابحث بالاسم أو الكود الداخلي أو أي كود خارجي (SKU/ASIN/باركود). اضغط الصنف لعرض تفاصيله.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 sm:grid-cols-5 items-end">
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="q">بحث</Label><Input id="q" name="q" defaultValue={q} placeholder="اسم / كود / SKU / ASIN / باركود" /></div>
            <div className="space-y-1">
              <Label htmlFor="category">الفئة</Label>
              <select id="category" name="category" defaultValue={fCategory} className={selectCls}>
                <option value="">الكل</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="status">الحالة</Label>
              <select id="status" name="status" defaultValue={fStatus} className={selectCls}>
                <option value="">الكل</option>
                <option value="active">نشط</option>
                <option value="inactive">متوقف</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="missing">فلتر ذكي</Label>
              <select id="missing" name="missing" defaultValue={fMissing} className={selectCls}>
                <option value="">—</option>
                <option value="image">بدون صورة</option>
                <option value="codes">بدون أكواد</option>
              </select>
            </div>
            <div className="flex gap-2 sm:col-span-5">
              <Button type="submit"><Icon name="Search" className="size-4" />بحث</Button>
              {hasFilters && <Button type="button" variant="outline" asChild><Link href="/erp/inventory/items">مسح</Link></Button>}
            </div>
          </form>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{hasFilters ? "لا توجد نتائج مطابقة." : "لا توجد أصناف بعد."}</div>
          ) : (
            <>
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
                            ? <img src={r.image} alt="" className="size-full object-contain" />
                            : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-4" /></div>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        <Link href={`/erp/inventory/items/${r.id}`} className="text-primary underline">{r.code}</Link>
                      </TableCell>
                      <TableCell className="max-w-[360px]"><div className="truncate" title={r.nameAr ?? ""}>{r.nameAr ?? "—"}</div></TableCell>
                      <TableCell>{Number(r.codeCount) > 0 ? <Badge variant="secondary">{Number(r.codeCount).toLocaleString("ar-EG-u-nu-latn")}</Badge> : "—"}</TableCell>
                      <TableCell>{money(r.sellPrice)}</TableCell>
                      <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "نشط" : "متوقف"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>صفحة {safePage} من {pages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={safePage <= 1} asChild={safePage > 1}>
                    {safePage > 1 ? <a href={qs(safePage - 1)}>السابق</a> : <span>السابق</span>}
                  </Button>
                  <Button variant="outline" size="sm" disabled={safePage >= pages} asChild={safePage < pages}>
                    {safePage < pages ? <a href={qs(safePage + 1)}>التالي</a> : <span>التالي</span>}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
