import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import { canAccessWorkspace } from "@/lib/workspaces";
import { can } from "@/lib/rbac";
import {
  getProductDetail,
  listStatuses,
  workspaceAssignees,
} from "@/lib/queries/products";
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
import { formatDateAr } from "@/lib/format";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getProductDetail(id);
  if (!detail) notFound();

  const { product: p } = detail;
  if (!(await canAccessWorkspace(user, p.workspaceId))) notFound();

  const canEdit = can(user.role, "product.edit");
  const [statuses, assignees, history] = await Promise.all([
    listStatuses(p.workspaceId),
    workspaceAssignees(p.workspaceId),
    listEntityActivity("product", id),
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <h1 className="text-xl font-bold">{p.name}</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground" dir="ltr">{p.sku}</p>

            {/* Images */}
            {p.images && p.images.length > 0 && (
              <div className="mt-4 grid grid-cols-4 gap-2">
                {p.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="" className="aspect-square rounded-xl border object-cover" />
                ))}
              </div>
            )}

            {/* Locked base data §9 */}
            <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <Field label="ASIN" value={p.asin} mono />
              <Field label="البراند" value={p.brand} />
              <Field label="السعر" value={p.price ? `${p.price} ر.س` : null} />
              {Object.entries(baseData).map(([k, v]) => (
                <Field key={k} label={k} value={String(v)} />
              ))}
            </div>
          </Card>

          {/* Open editable fields §9 */}
          <Card className="space-y-5 p-6">
            <h2 className="font-semibold">الحقول القابلة للتعديل</h2>
            <EditableField productId={id} field="notes" label="ملاحظات" value={p.notes} canEdit={canEdit} placeholder="أضف ملاحظة…" />
            <EditableField productId={id} field="amazonCode" label="Amazon Code" value={p.amazonCode} canEdit={canEdit} />
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
                disabled={!canEdit}
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
