import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/products/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PartnerProductRow = {
  id: string;
  sku: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  imageUrl: string | null;
  amazonCode: string | null;
  notes: string | null;
  statusName: string | null;
  statusColor: string | null;
  workspaceName?: string | null;
};

/** Partner-safe products table — product data + status + code + notes only.
 *  No assignee, no internal notes, no AI tools. */
export function PartnerProductsTable({
  rows,
  showWorkspace = false,
}: {
  rows: PartnerProductRow[];
  showWorkspace?: boolean;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-14 text-right">الصورة</TableHead>
            <TableHead className="text-right">المنتج</TableHead>
            {showWorkspace && <TableHead className="text-right">المتجر</TableHead>}
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
                <p className="truncate font-medium">{p.name ?? "—"}</p>
                <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">{p.sku}</p>
              </TableCell>
              {showWorkspace && (
                <TableCell className="text-sm text-muted-foreground">{p.workspaceName ?? "—"}</TableCell>
              )}
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
  );
}
