import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { products, productBases, productStatuses, workspaces } from "@/db/schema";
import { getWorkspaceStats } from "@/lib/queries/workspace-stats";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/products/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function PortalWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  // Ownership check — client may only view their own workspaces.
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.clientUserId, user.id)))
    .limit(1);
  if (!ws) notFound();

  const [stats] = await Promise.all([getWorkspaceStats([id])]);
  const s = stats[id];

  // Read-only product list for the partner — product data + status + platform
  // code + notes. NO assignee, NO internal notes, NO AI tools. Drafts hidden.
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: productBases.name,
      brand: productBases.brand,
      price: productBases.price,
      imageUrl: productBases.imageUrl,
      productUrl: productBases.productUrl,
      amazonCode: products.amazonCode,
      notes: products.notes,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(productBases, eq(products.baseId, productBases.id))
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(and(eq(products.workspaceId, id), eq(products.isDraft, false)))
    .orderBy(desc(products.updatedAt))
    .limit(300);

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/portal" className="hover:text-foreground">الرئيسية</Link>
        <ChevronRight className="size-4 rotate-180" />
        <span className="text-foreground">{ws.name}</span>
      </nav>

      <PageHeader title={ws.name} description="حالة العمل على منتجات متجرك" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="المنتجات" value={s.productCount} icon="Package" tone="blue" />
        <StatCard label="مكتمل" value={s.completedCount} icon="CheckCircle2" tone="green" />
        <StatCard label="نسبة الإنجاز" value={`${s.completion}%`} icon="TrendingUp" tone="yellow" />
      </div>

      <Card className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-14 text-right">الصورة</TableHead>
              <TableHead className="text-right">المنتج</TableHead>
              <TableHead className="text-right">البراند</TableHead>
              <TableHead className="text-right">السعر</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
              <TableHead className="text-right">الكود</TableHead>
              <TableHead className="text-right">ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.name ?? ""} loading="lazy" decoding="async" className="size-10 rounded-lg border object-cover" />
                  ) : (
                    <div className="size-10 rounded-lg border bg-muted" />
                  )}
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">{p.sku}</p>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.brand ?? "—"}</TableCell>
                <TableCell className="tabular-nums text-sm" dir="ltr">{p.price ?? "—"}</TableCell>
                <TableCell><StatusBadge name={p.statusName} color={p.statusColor} /></TableCell>
                <TableCell className="font-mono text-xs" dir="ltr">{p.amazonCode ?? "—"}</TableCell>
                <TableCell className="max-w-[220px] text-sm text-muted-foreground">
                  <span className="line-clamp-2 whitespace-pre-wrap">{p.notes ?? "—"}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">لا توجد منتجات بعد</p>}
      </Card>
    </div>
  );
}
