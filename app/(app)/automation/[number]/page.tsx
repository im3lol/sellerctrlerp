import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRules, organizationMembers, users } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { docNumberParam } from "@/lib/erp/doc-route";
import { erpRoleLabels } from "@/lib/erp/permissions";
import { maskSpec, type RuleSpec } from "@/lib/erp/automation/model";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AutomationEditor } from "@/components/erp/automation-editor";

export const dynamic = "force-dynamic";

export default async function AutomationRulePage({ params }: { params: Promise<{ number: string }> }) {
  const t = await getT();
  const raw = (await params).number;
  return loadErpPage("automation.manage", async ({ orgId }) => {
    const isNew = raw === "new";
    const number = isNew ? null : await docNumberParam(raw, orgId, automationRules,
      { id: automationRules.id, number: automationRules.number, organizationId: automationRules.organizationId }, "/automation");
    const [rule] = number === null ? [] : await db.select().from(automationRules)
      .where(and(eq(automationRules.number, number), eq(automationRules.organizationId, orgId))).limit(1);
    if (!isNew && !rule) notFound();

    const members = await db.select({ id: organizationMembers.userId, name: users.name, role: organizationMembers.role })
      .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)))
      .orderBy(asc(users.name));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Workflow" backHref="/automation"
          title={rule ? rule.name : "قاعدة أتمتة جديدة"}
          subtitle={t("لما ← لو ← اعمل")} />
        <AutomationEditor
          rule={rule ? { id: rule.id, name: rule.name, enabled: rule.enabled, spec: maskSpec(rule.spec as RuleSpec) } : null}
          members={members.map((m) => ({ id: m.id, name: m.name ?? "—", role: erpRoleLabels[m.role] ?? m.role }))}
          roles={Object.entries(erpRoleLabels).map(([value, label]) => ({ value, label }))}
        />
      </div>
    );
  }, "settings");
}
