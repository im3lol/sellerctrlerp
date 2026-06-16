import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { products, productStatuses, workspaces } from "@/db/schema";
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

  // Read-only product list — NO assignee or internal notes (§22).
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      brand: products.brand,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .where(eq(products.workspaceId, id))
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

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right">SKU</TableHead>
              <TableHead className="text-right">المنتج</TableHead>
              <TableHead className="text-right">البراند</TableHead>
              <TableHead className="text-right">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs" dir="ltr">{p.sku}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.brand ?? "—"}</TableCell>
                <TableCell><StatusBadge name={p.statusName} color={p.statusColor} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">لا توجد منتجات بعد</p>}
      </Card>
    </div>
  );
}
