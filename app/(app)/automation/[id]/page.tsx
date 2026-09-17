import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRules, organizationMembers, users } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { erpRoleLabels } from "@/lib/erp/permissions";
import { maskSpec, type RuleSpec } from "@/lib/erp/automation/model";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AutomationEditor } from "@/components/erp/automation-editor";

export const dynamic = "force-dynamic";

export default async function AutomationRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadErpPage("automation.manage", async ({ orgId }) => {
    const [rule] = id === "new" ? [] : await db.select().from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, orgId))).limit(1);
    if (id !== "new" && !rule) notFound();

    const members = await db.select({ id: organizationMembers.userId, name: users.name, role: organizationMembers.role })
      .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)))
      .orderBy(asc(users.name));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Workflow" backHref="/automation"
          title={rule ? rule.name : "قاعدة أتمتة جديدة"}
          subtitle="لما ← لو ← اعمل" />
        <AutomationEditor
          rule={rule ? { id: rule.id, name: rule.name, enabled: rule.enabled, spec: maskSpec(rule.spec as RuleSpec) } : null}
          members={members.map((m) => ({ id: m.id, name: m.name ?? "—", role: erpRoleLabels[m.role] ?? m.role }))}
          roles={Object.entries(erpRoleLabels).map(([value, label]) => ({ value, label }))}
        />
      </div>
    );
  }, "settings");
}
