import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { products, productBases, productStatuses, workspaces } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PartnerProductsTable } from "@/components/portal/partner-products-table";
import { ProductsPagination } from "@/components/products/products-pagination";

const PER_PAGE = 30;

export default async function PortalProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const myWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.clientUserId, user.id), eq(workspaces.isArchived, false)));
  const wsIds = myWorkspaces.map((w) => w.id);

  if (wsIds.length === 0) {
    return (
      <div>
        <PageHeader title="المنتجات" description="منتجاتك عبر متاجرك" />
        <EmptyState icon="Package" title="لا توجد منتجات" description="لم تُربط متاجر بحسابك بعد." />
      </div>
    );
  }

  const cond = and(inArray(products.workspaceId, wsIds), eq(products.isDraft, false));
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(products).where(cond),
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: productBases.name,
        brand: productBases.brand,
        price: productBases.price,
        imageUrl: productBases.imageUrl,
        amazonCode: products.amazonCode,
        notes: products.notes,
        statusName: productStatuses.name,
        statusColor: productStatuses.color,
        workspaceName: workspaces.name,
      })
      .from(products)
      .leftJoin(productBases, eq(products.baseId, productBases.id))
      .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(cond)
      .orderBy(desc(products.updatedAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div>
      <PageHeader title="المنتجات" description={`${total} منتج عبر متاجرك`} />
      {total === 0 ? (
        <EmptyState icon="Package" title="لا توجد منتجات" description="لم تُضف منتجات لمتاجرك بعد." />
      ) : (
        <>
          <PartnerProductsTable rows={rows} showWorkspace />
          <ProductsPagination page={page} totalPages={totalPages} total={total} perPage={PER_PAGE} />
        </>
      )}
    </div>
  );
}
