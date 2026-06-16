import { desc, eq } from "drizzle-orm";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import { sheetsConnections, workspaces } from "@/db/schema";
import { sheetsConfigured } from "@/lib/sheets";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { ConnectSheetDialog } from "@/components/sheets/connect-sheet-dialog";
import { ConnectionCard } from "@/components/sheets/connection-card";

export default async function SheetsAdminPage() {
  await requireCapability("sheets.connect");

  const [conns, wsList] = await Promise.all([
    db
      .select({
        id: sheetsConnections.id,
        spreadsheetId: sheetsConnections.spreadsheetId,
        sheetName: sheetsConnections.sheetName,
        autoSync: sheetsConnections.autoSync,
        lastSyncAt: sheetsConnections.lastSyncAt,
        lastSyncStatus: sheetsConnections.lastSyncStatus,
        workspaceName: workspaces.name,
      })
      .from(sheetsConnections)
      .leftJoin(workspaces, eq(sheetsConnections.workspaceId, workspaces.id))
      .orderBy(desc(sheetsConnections.createdAt)),
    db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(eq(workspaces.isArchived, false)),
  ]);

  return (
    <div>
      <PageHeader title="ربط Google Sheets" description="استيراد المنتجات ومزامنتها تلقائياً">
        <ConnectSheetDialog workspaces={wsList} />
      </PageHeader>

      {!sheetsConfigured() && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="size-4" />
          <AlertTitle>لم يتم ضبط حساب الخدمة</AlertTitle>
          <AlertDescription>
            أضف بيانات حساب خدمة Google في المتغيّر البيئي GOOGLE_SERVICE_ACCOUNT_JSON لتفعيل المزامنة.
          </AlertDescription>
        </Alert>
      )}

      {conns.length === 0 ? (
        <EmptyState
          icon="Sheet"
          title="لا توجد جداول مرتبطة"
          description="اربط Google Sheet لاستيراد المنتجات تلقائياً."
        />
      ) : (
        <div className="space-y-3">
          {conns.map((c) => (
            <ConnectionCard key={c.id} conn={c} />
          ))}
        </div>
      )}
    </div>
  );
}
