import { eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SettingsForm, type OrgProfile } from "@/components/erp/settings-form";
import { parseApprovalPolicy, parseStuckDays } from "@/lib/erp/approval-policy";
import { parseReminderPolicy } from "@/lib/erp/reminders";
import { OrgDeletionCard } from "@/components/erp/org-deletion";
import { DELETION_GRACE_DAYS, deletionDueAt } from "@/lib/erp/org-deletion";

export default async function OrganizationSettingsPage() {
  return loadErpPage("settings.view", async ({ orgId, can, role }) => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);

    const profile: OrgProfile = {
      nameAr: org?.nameAr ?? "",
      nameEn: org?.nameEn ?? "",
      legalName: org?.legalName ?? null,
      taxNumber: org?.taxNumber ?? null,
      address: org?.address ?? null,
      phone: org?.phone ?? null,
      email: org?.email ?? null,
      logo: org?.logo ?? null,
      vatRate: org?.vatRate ?? "14",
      fiscalYearStart: org?.fiscalYearStart ?? null,
      approvalPolicy: parseApprovalPolicy(org?.approvalPolicy),
      stuckDays: parseStuckDays(org?.approvalPolicy),
      reminders: parseReminderPolicy(org?.approvalPolicy),
      purchaseVatCapitalised: Boolean(org?.purchaseVatCapitalised),
      navHidden: org?.navHidden ?? [],
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Building2" title="بيانات المنشأة" subtitle="الاسم والشعار وبيانات التواصل والإعدادات الضريبية" backHref="/settings" />
        <SettingsForm section="profile" profile={profile} config={null} accounts={[]} canEdit={can("settings.edit")} />
        {role === "admin" && org && !org.isSandbox && (
          <OrgDeletionCard orgName={org.nameAr} graceDays={DELETION_GRACE_DAYS}
            dueAt={org.deletionRequestedAt ? deletionDueAt(new Date(org.deletionRequestedAt)).toISOString() : null} />
        )}
      </div>
    );
  });
}
