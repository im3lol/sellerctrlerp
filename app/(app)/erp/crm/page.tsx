import { and, asc, desc, eq } from "drizzle-orm";
import { erpCan } from "@/lib/erp/org";
import { requireCrm } from "@/lib/crm/guard";
import { db } from "@/lib/db";
import { crmStages, crmOpportunities, customers, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { CrmPipeline } from "@/components/erp/crm-pipeline";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function CrmPipelinePage() {
  const { orgId, role } = await requireCrm();
  const canManage = erpCan(role, "sales.create");

  const [stages, opps, customerList] = await Promise.all([
    db.select().from(crmStages).where(eq(crmStages.organizationId, orgId)).orderBy(asc(crmStages.sortOrder)),
    db
      .select({
        id: crmOpportunities.id,
        number: crmOpportunities.number,
        name: crmOpportunities.name,
        customerId: crmOpportunities.customerId,
        customerName: customers.nameAr,
        contactName: crmOpportunities.contactName,
        phone: crmOpportunities.phone,
        email: crmOpportunities.email,
        stageId: crmOpportunities.stageId,
        expectedRevenue: crmOpportunities.expectedRevenue,
        probability: crmOpportunities.probability,
        status: crmOpportunities.status,
        source: crmOpportunities.source,
        notes: crmOpportunities.notes,
        expectedCloseDate: crmOpportunities.expectedCloseDate,
        salesperson: users.name,
      })
      .from(crmOpportunities)
      .leftJoin(customers, eq(customers.id, crmOpportunities.customerId))
      .leftJoin(users, eq(users.id, crmOpportunities.salespersonId))
      .where(eq(crmOpportunities.organizationId, orgId))
      .orderBy(desc(crmOpportunities.updatedAt)),
    db.select({ id: customers.id, name: customers.nameAr }).from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.isActive, true))).orderBy(asc(customers.nameAr)),
  ]);

  const open = opps.filter((o) => o.status === "OPEN");
  const won = opps.filter((o) => o.status === "WON");
  const lost = opps.filter((o) => o.status === "LOST");
  const openValue = open.reduce((s, o) => s + Number(o.expectedRevenue), 0);
  const wonValue = won.reduce((s, o) => s + Number(o.expectedRevenue), 0);
  const weighted = open.reduce((s, o) => s + Number(o.expectedRevenue) * (o.probability / 100), 0);
  const closed = won.length + lost.length;
  const winRate = closed > 0 ? Math.round((won.length / closed) * 100) : 0;

  const kpis = [
    { label: "قيمة الفرص المفتوحة", value: money(openValue), icon: "Target", tone: "text-foreground" },
    { label: "القيمة المرجّحة (متوقّعة)", value: money(weighted), icon: "TrendingUp", tone: "text-emerald-600" },
    { label: "فرص مفتوحة", value: intf(open.length), icon: "Briefcase", tone: "text-foreground" },
    { label: "مكسوبة", value: `${money(wonValue)}`, icon: "Trophy", tone: "text-emerald-600" },
    { label: "نسبة الكسب", value: `${intf(winRate)}%`, icon: "Percent", tone: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Target" title="خط أنابيب المبيعات (CRM)" subtitle={`${intf(open.length)} فرصة مفتوحة · ${intf(lost.length)} خاسرة`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className={cn("mt-1 text-xl font-bold tabular-nums", k.tone)}>{k.value}</div>
              </div>
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon name={k.icon} className="size-4" /></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CrmPipeline stages={stages} opportunities={opps} customers={customerList} canManage={canManage} />
    </div>
  );
}
