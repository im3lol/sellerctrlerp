import Link from "next/link";
import { requireErpModule } from "@/lib/erp/org";
import { getPendingDrafts } from "@/lib/erp/drafts";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function DraftsPage() {
  const { orgId } = await requireErpModule("sales.view");
  const drafts = await getPendingDrafts(orgId);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="FileClock" title="مسودات بانتظار التأكيد" subtitle={`${drafts.length} مستند يحتاج مراجعة وتأكيد`} backHref="/dashboard" />
      <Card>
        <CardContent className="p-0">
          {drafts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">لا توجد مسودات معلّقة — كل المستندات مؤكَّدة ✅</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">النوع</TableHead>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((d) => (
                  <TableRow key={`${d.path}/${d.number}`}>
                    <TableCell><Badge variant="secondary">{d.label}</Badge></TableCell>
                    <TableCell className="font-mono">{d.number}</TableCell>
                    <TableCell>{dt(d.date)}</TableCell>
                    <TableCell><Link href={`${d.path}/${encodeURIComponent(d.number)}`} className="text-primary hover:underline">فتح ←</Link></TableCell>
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
