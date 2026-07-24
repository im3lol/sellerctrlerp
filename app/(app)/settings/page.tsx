import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { organizations, accounts, accountingConfigurations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { SettingsForm, type OrgProfile, type AccountOption, type AccountingConfig } from "@/components/erp/settings-form";
import { listBackups } from "@/lib/erp/backup";

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} ك.ب` : `${(b / 1024 / 1024).toFixed(1)} م.ب`);
const bdt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });

const MANAGE_LINKS = [
  { label: "إعداد الحساب",         href: "/setup",                  icon: "Rocket" },
  { label: "دليل الحسابات",       href: "/accounting/chart",       icon: "Calculator" },
  { label: "الفترات المالية",      href: "/accounting/periods",     icon: "Lock" },
  { label: "مراكز التكلفة",        href: "/accounting/cost-centers", icon: "Target" },
  { label: "المستودعات والأصناف",  href: "/inventory/items",        icon: "Warehouse" },
  { label: "ترقيم المستندات",     href: "/settings/numbering",     icon: "Hash" },
  { label: "العملات وأسعار الصرف", href: "/settings/currencies",    icon: "BadgeDollarSign" },
  { label: "صلاحيات المستخدمين",   href: "/settings/permissions",   icon: "ShieldCheck" },
  { label: "الاشتراك والباقة",     href: "/settings/subscription",  icon: "CreditCard" },
  { label: "مفاتيح الـ API",       href: "/settings/api-keys",      icon: "KeyRound" },
] as const;

export default async function ErpSettingsPage() {
  return loadErpPage("settings.view", async ({ orgId, role, can }) => {
    const canEdit = can("settings.edit");
    const backups = canEdit ? await listBackups(orgId, 8) : [];

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
      logo: org?.logo ?? null,
      vatRate: org?.vatRate ?? "14",
      fiscalYearStart: org?.fiscalYearStart ?? null,
      poApprovalThreshold: org?.poApprovalThreshold ?? "0",
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
        <ErpPageHeader icon="Settings" title="الإعدادات" subtitle="إعداد المنشأة والضبط المحاسبي" />

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

        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle>نسخة احتياطية من بياناتك</CardTitle>
              <CardDescription>حمّل نسخة كاملة من بيانات مؤسستك (كل الجداول) كملف مضغوط — احتفظ بها أو انقلها متى شئت.</CardDescription>
            </CardHeader>
            <CardContent>
              <a href="/api/erp/backup" download className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                <Icon name="Download" className="size-4" />تحميل نسخة من بياناتي
              </a>
              {backups.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <div className="mb-2 text-sm font-medium text-muted-foreground">نسخ محفوظة تلقائيًا</div>
                  <ul className="divide-y">
                    {backups.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-muted-foreground">{bdt(b.createdAt)} · {fmtBytes(b.sizeBytes)}</span>
                        <a href={`/api/erp/backups/${b.id}`} className="text-primary hover:underline">تنزيل</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  });
}
