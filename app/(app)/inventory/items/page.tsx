import Link from "next/link";
import { and, or, asc, count, eq, ilike, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes, itemCategories } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemsTable } from "@/components/erp/items-table";
import { ExportCsvButton } from "@/components/erp/export-csv-button";
import { exportItemsCsvAction } from "@/app/actions/erp/exports";
import { selectCls } from "@/lib/utils";

const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const PER_PAGE = 20;

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId, role, can }) => {
    const canManage = can("inventory.create");
    const sp = await searchParams;
    const q = one(sp.q).trim();
    const fStatus = one(sp.status); // active | inactive | ""
    const fCategory = one(sp.category);
    const fMissing = one(sp.missing); // image | codes | ""
    const fReview = one(sp.review) === "1"; // items auto-created from orders, awaiting review
    const showRelated = one(sp.related) === "1"; // also list the whole variation family of matched items
    const page = Math.max(1, parseInt(one(sp.page) || "1", 10) || 1);

    const conds = [eq(items.organizationId, orgId)];
    if (q) {
      const norm = normalizeCode(q);
      const codeItemIds = norm
        ? (await db.select({ id: itemCodes.itemId }).from(itemCodes)
            .where(and(eq(itemCodes.organizationId, orgId), ilike(itemCodes.normalizedCode, `%${norm}%`))).limit(200)).map((r) => r.id)
        : [];
      const search = [ilike(items.code, `%${q}%`), ilike(items.nameAr, `%${q}%`)];
      if (codeItemIds.length) search.push(inArray(items.id, [...new Set(codeItemIds)]));
      conds.push(or(...search)!);
    }
    if (fStatus === "active") conds.push(eq(items.isActive, true));
    if (fStatus === "inactive") conds.push(eq(items.isActive, false));
    if (fReview) conds.push(eq(items.needsReview, true));
    if (fCategory) conds.push(eq(items.categoryId, fCategory));
    if (fMissing === "image") conds.push(isNull(items.image));
    if (fMissing === "codes") {
      const withCodes = [...new Set((await db.select({ id: itemCodes.itemId }).from(itemCodes)
        .where(eq(itemCodes.organizationId, orgId))).map((r) => r.id))];
      if (withCodes.length) conds.push(notInArray(items.id, withCodes));
    }
    // "إظهار المنتجات المرتبطة": pull in the WHOLE variation family of any matched
    // item — the family head (parent, or the item itself) plus all its variations.
    // So matching a child by its code also surfaces its parent + siblings.
    let where = and(...conds);
    if (showRelated) {
      const matched = await db.select({ id: items.id, parentItemId: items.parentItemId }).from(items).where(where);
      const headIds = [...new Set(matched.map((m) => m.parentItemId ?? m.id))];
      if (headIds.length) {
        where = or(
          and(...conds)!,
          inArray(items.id, headIds), // the family heads
          inArray(items.parentItemId, headIds), // all variations under those heads
        )!;
      }
    }

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
        parentItemId: items.parentItemId,
        codeCount: sql<number>`count(${itemCodes.id})`,
        childCount: sql<number>`(SELECT count(*) FROM items c WHERE c.parent_item_id = ${items.id})`,
      })
      .from(items)
      .leftJoin(itemCodes, eq(itemCodes.itemId, items.id))
      .where(where)
      .groupBy(items.id)
      .orderBy(asc(items.code))
      .limit(PER_PAGE)
      .offset((safePage - 1) * PER_PAGE);

    const hasFilters = Boolean(q || fStatus || fCategory || fMissing || showRelated);
    const qs = (p: number) => {
      const u = new URLSearchParams();
      if (q) u.set("q", q);
      if (fStatus) u.set("status", fStatus);
      if (fCategory) u.set("category", fCategory);
      if (fMissing) u.set("missing", fMissing);
      if (showRelated) u.set("related", "1");
      u.set("page", String(p));
      return `?${u.toString()}`;
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Package"
          title="الأصناف"
          subtitle={`${total} صنف`}
          backHref="/inventory"
          action={
            <div className="flex items-center gap-2">
              <ExportCsvButton action={exportItemsCsvAction} />
              {canManage && <Button asChild data-tour="new-item"><Link href="/inventory/items/new"><Icon name="Plus" className="size-4" />صنف جديد</Link></Button>}
            </div>
          }
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
              <div className="flex flex-wrap items-center gap-3 sm:col-span-5">
                <Button type="submit"><Icon name="Search" className="size-4" />بحث</Button>
                {hasFilters && <Button type="button" variant="outline" asChild><Link href="/inventory/items">مسح</Link></Button>}
                <label className="flex cursor-pointer items-center gap-2 text-sm" title="عند البحث بكود صنف، أظهر معه بقية عائلته (الأب والتنويعات الأخرى)">
                  <input type="checkbox" name="related" value="1" defaultChecked={showRelated} className="size-4 rounded border-input" />
                  إظهار المنتجات المرتبطة
                </label>
              </div>
            </form>

            {rows.length === 0 ? (
              hasFilters ? (
                <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد نتائج مطابقة.</div>
              ) : (
                <div className="space-y-4 rounded-xl border border-dashed py-12 text-center">
                  <div className="text-muted-foreground">لا توجد أصناف بعد — ابدأ بإضافة منتجاتك بإحدى الطرق:</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild><Link href="/inventory/items/new"><Icon name="Plus" className="size-4" />صنف جديد</Link></Button>
                    <Button asChild variant="outline"><Link href="/imports"><Icon name="Upload" className="size-4" />استيراد ملف</Link></Button>
                    <Button asChild variant="outline"><Link href="/platforms"><Icon name="Store" className="size-4" />مزامنة من أمازون</Link></Button>
                  </div>
                </div>
              )
            ) : (
              <>
                <ItemsTable
                  rows={rows.map((r) => ({ ...r, codeCount: Number(r.codeCount), childCount: Number(r.childCount) }))}
                  total={Number(total)}
                  canDelete={can("inventory.delete")}
                  filter={{ q, status: fStatus, category: fCategory, missing: fMissing }}
                />
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
  });
}
