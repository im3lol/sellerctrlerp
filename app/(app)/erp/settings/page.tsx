import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { organizations, accounts, accountingConfigurations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { SettingsForm, type OrgProfile, type AccountOption, type AccountingConfig } from "@/components/erp/settings-form";

const MANAGE_LINKS = [
  { label: "دليل الحسابات", href: "/erp/accounting/chart", icon: "Calculator" },
  { label: "الفترات المالية", href: "/erp/accounting/periods", icon: "Lock" },
  { label: "مراكز التكلفة", href: "/erp/accounting/cost-centers", icon: "Target" },
  { label: "المستودعات والأصناف", href: "/erp/inventory/items", icon: "Warehouse" },
] as const;

export default async function ErpSettingsPage() {
  const { orgId, role } = await requireErpModule("settings.view");
  const canEdit = erpCan(role, "settings.edit");

  const [[org], accs, [config]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.organizationId, orgId), eq(accounts.isActive, true)))
      .orderBy(asc(accounts.code)),
    db.select().from(accountingConfigurations).where(eq(accountingConfigurations.organizationId, orgId)).limit(1),
  ]);

  const profile: OrgProfile = {
    nameAr: org?.nameAr ?? "",
    nameEn: org?.nameEn ?? "",
    legalName: org?.legalName ?? null,
    taxNumber: org?.taxNumber ?? null,
    address: org?.address ?? null,
    phone: org?.phone ?? null,
    email: org?.email ?? null,
    vatRate: org?.vatRate ?? "14",
    fiscalYearStart: org?.fiscalYearStart ?? null,
  };
  const accountOptions: AccountOption[] = accs;
  const accountingConfig: AccountingConfig = config
    ? {
        receivableAccountId: config.receivableAccountId,
        payableAccountId: config.payableAccountId,
        cashAccountId: config.cashAccountId,
        bankAccountId: config.bankAccountId,
        salesAccountId: config.salesAccountId,
        purchaseAccountId: config.purchaseAccountId,
        outputTaxAccountId: config.outputTaxAccountId,
        inputTaxAccountId: config.inputTaxAccountId,
        inventoryAccountId: config.inventoryAccountId,
        cogsAccountId: config.cogsAccountId,
      }
    : null;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Settings" title="إعدادات ERP" subtitle="إعداد المنشأة والضبط المحاسبي" />

      <SettingsForm profile={profile} config={accountingConfig} accounts={accountOptions} canEdit={canEdit} />

      <Card>
        <CardHeader>
          <CardTitle>إدارة البيانات الأساسية</CardTitle>
          <CardDescription>الوصول لشاشات إدارة الحسابات والفترات والأصناف.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MANAGE_LINKS.map((s) => (
              <Link key={s.href} href={s.href} className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-accent">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Icon name={s.icon} className="size-4" /></div>
                <span className="flex-1 text-sm font-medium">{s.label}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
