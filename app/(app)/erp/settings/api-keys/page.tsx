import { desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { apiKeys } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ApiKeysManager } from "@/components/erp/api-keys-manager";

const dt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "");

export default async function ApiKeysPage() {
  const { orgId } = await requireErpModule("settings.view");
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.organizationId, orgId)).orderBy(desc(apiKeys.createdAt));
  const keys = rows.map((k) => ({ id: k.id, name: k.name, hint: k.keyHint, lastUsed: dt(k.lastUsedAt), active: k.isActive }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="KeyRound" title="مفاتيح الـ API" subtitle="اربط أنظمتك الخارجية بالبيانات عبر REST API" backHref="/erp/settings" />
      <ApiKeysManager keys={keys} />
      <Card>
        <CardHeader><CardTitle className="text-base">نقاط النهاية المتاحة (قراءة فقط)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">أرسل المفتاح في الترويسة <code dir="ltr">Authorization: Bearer &lt;key&gt;</code> أو <code dir="ltr">x-api-key</code>.</p>
          <ul className="space-y-1 font-mono text-xs" dir="ltr">
            <li><Badge>GET</Badge> /api/v1/items — الأصناف (كود، اسم، سعر البيع، حد الطلب)</li>
            <li><Badge>GET</Badge> /api/v1/stock — الأرصدة (المتوفّر + القيمة لكل صنف)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
