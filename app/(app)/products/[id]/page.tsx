import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireCrm } from "@/lib/crm/guard";
import { canAccessWorkspace, getAccessibleWorkspaces } from "@/lib/workspaces";
import { can } from "@/lib/rbac";
import {
  getProductDetail,
  listStatuses,
  workspaceAssignees,
  listingsForBase,
} from "@/lib/queries/products";
import { ProductPlatforms } from "@/components/products/product-platforms";
import { listEntityActivity } from "@/lib/queries/activity";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/products/status-badge";
import {
  ProductStatusSelect,
  ProductAssigneeSelect,
} from "@/components/products/inline-editors";
import { EditableField } from "@/components/products/editable-field";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { CommentsSection } from "@/components/comments/comments-section";
import { ListingButton } from "@/components/products/listing-button";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { DraftConfirmBanner } from "@/components/products/draft-confirm-banner";
import { formatDateAr } from "@/lib/format";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, orgId } = await requireCrm();
  const { id } = await params;
  const detail = await getProductDetail(id);
  if (!detail) notFound();

  const { product: p } = detail;
  if (!(await canAccessWorkspace(user, p.workspaceId))) notFound();

  const canEdit = can(user.role, "product.edit");
  const canReview = can(user.role, "product.review");
  // Draft products are hidden from non-reviewers (employees/clients) until confirmed.
  if (p.isDraft && !canReview) notFound();
  const canManageListings = can(user.role, "product.distribute");
  const [statuses, assignees, history, listings, addable] = await Promise.all([
    listStatuses(p.workspaceId),
    workspaceAssignees(p.workspaceId),
    listEntityActivity("product", id),
    p.baseId ? listingsForBase(p.baseId) : Promise.resolve([]),
    canManageListings ? getAccessibleWorkspaces(user, orgId).then((ws) => ws.map((w) => ({ id: w.id, name: w.name }))) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const statusOptions = statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const baseData = (p.baseData ?? {}) as Record<string, unknown>;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/products" className="hover:text-foreground">المنتجات</Link>
        <ChevronRight className="size-4 rotate-180" />
        <Link href={`/workspaces/${p.workspaceId}`} className="hover:text-foreground">
          {detail.workspaceName}
        </Link>
        <ChevronRight className="size-4 rotate-180" />
        <span className="text-foreground">{p.name}</span>
      </nav>

      {p.isDraft && canReview && <DraftConfirmBanner productId={id} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{p.name}</h1>
                <p className="mt-1 font-mono text-sm text-muted-foreground" dir="ltr">{p.sku}</p>
              </div>
              {canEdit && (
                <ProductFormDialog
                  mode="edit"
                  statuses={statusOptions}
                  assignees={assignees}
                  product={{
                    id: p.id,
                    workspaceId: p.workspaceId,
                    name: p.name,
                    brand: p.brand,
                    description: p.description,
                    features: p.features,
                    sizes: p.sizes,
                    price: p.price,
                    imageUrl: p.imageUrl,
                    galleryUrl: p.galleryUrl,
                    productUrl: p.productUrl,
                    statusId: p.statusId,
                    assignedTo: p.assignedTo,
                  }}
                />
              )}
            </div>

            {/* Main image + gallery */}
            {p.imageUrl && (
              <div className="mt-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" className="max-h-72 w-full rounded-xl border object-contain" />
              </div>
            )}

            {/* Locked data from the imported Excel */}
            <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <Field label="البراند" value={p.brand} />
              <Field label="السعر" value={p.price ? String(p.price) : null} />
              <Field label="المقاسات" value={p.sizes} />
              {p.productUrl && (
                <LinkField label="رابط المنتج على الموقع" href={p.productUrl} />
              )}
              {p.galleryUrl && (
                <LinkField label="صور المنتج (درايف)" href={p.galleryUrl} />
              )}
              {p.features && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">مميزات المنتج</p>
                  <p className="whitespace-pre-wrap">{p.features}</p>
                </div>
              )}
              {p.description && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">وصف المنتج</p>
                  <p className="whitespace-pre-wrap">{p.description}</p>
                </div>
              )}
              {Object.entries(baseData).map(([k, v]) => (
                <Field key={k} label={k} value={String(v)} />
              ))}
            </div>
          </Card>

          {/* Open editable fields — app-owned (§9) */}
          <Card className="space-y-5 p-6">
            <h2 className="font-semibold">الحقول القابلة للتعديل</h2>
            <EditableField productId={id} field="notes" label="ملاحظات" value={p.notes} canEdit={canEdit} placeholder="أضف ملاحظة…" />
            <EditableField productId={id} field="amazonCode" label="كود المنتج على المنصة" value={p.amazonCode} canEdit={canEdit} />
            <EditableField productId={id} field="internalNotes" label="ملاحظات داخلية" value={p.internalNotes} canEdit={canEdit} />
          </Card>

          {/* Comments §16 */}
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">التعليقات</h2>
            <CommentsSection entityType="product" entityId={id} workspaceId={p.workspaceId} />
          </Card>

          {/* History §11 / §17 */}
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">السجل الكامل</h2>
            <ActivityFeed items={history} />
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {(listings.length > 1 || (canManageListings && addable.length > 1)) && (
            <Card className="p-5">
              <ProductPlatforms productId={id} currentId={id} listings={listings} addableWorkspaces={addable} />
            </Card>
          )}

          <Card className="space-y-3 p-5">
            <div>
              <p className="font-semibold">وصف المنتج بالذكاء الاصطناعي</p>
              <p className="text-xs text-muted-foreground">حوّل بيانات المنتج إلى نص جاهز لأي منصة AI لإنشاء listing كامل.</p>
            </div>
            <ListingButton productId={id} variant="full" />
          </Card>

          <Card className="space-y-4 p-5">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">الحالة</p>
              {canEdit ? (
                <ProductStatusSelect productId={id} statusId={p.statusId} statuses={statusOptions} />
              ) : (
                <StatusBadge name={detail.statusName} color={detail.statusColor} />
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">المسؤول</p>
              <ProductAssigneeSelect
                productId={id}
                assignedTo={p.assignedTo}
                assignees={assignees}
                disabled={!canReview}
              />
            </div>
          </Card>

          <Card className="space-y-3 p-5 text-sm">
            <Row label="أُنشئ" value={formatDateAr(p.createdAt, true)} />
            <Row label="آخر تحديث" value={formatDateAr(p.updatedAt, true)} />
            {p.completedAt && <Row label="اكتمل" value={formatDateAr(p.completedAt, true)} />}
          </Card>
        </div>
      </div>
    </div>
  );
}

function LinkField({ label, href }: { label: string; href: string }) {
  return (
    <div className="col-span-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sm text-primary hover:underline"
        dir="ltr"
      >
        {href}
      </a>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono" : ""} dir={mono ? "ltr" : undefined}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
