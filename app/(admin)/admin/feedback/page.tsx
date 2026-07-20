import { withPlatformScope } from "@/lib/db-scope";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedback, organizations, users } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { FeedbackInbox } from "@/components/admin/feedback-inbox";

/**
 * Every tenant's suggestions and complaints in one inbox.
 *
 * Deliberately NOT org-scoped — reading across tenants is the entire point here, and
 * this is the only surface allowed to. Guarded by the (admin) layout (system_admin
 * only); the reply action re-checks employee.manage.
 */
export default async function AdminFeedbackPage() {
  return withPlatformScope(async () => {
    const rows = await db.select({
      id: feedback.id,
      kind: feedback.kind,
      subject: feedback.subject,
      message: feedback.message,
      status: feedback.status,
      reply: feedback.reply,
      createdAt: feedback.createdAt,
      orgName: organizations.nameAr,
      userName: users.name,
    })
      .from(feedback)
      .innerJoin(organizations, eq(feedback.organizationId, organizations.id))
      // Left join: userId is SET NULL on delete, so a submission outlives its author.
      // An inner join here would silently drop those from the inbox.
      .leftJoin(users, eq(feedback.userId, users.id))
      .orderBy(desc(feedback.createdAt))
      .limit(200);

    const items = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }),
    }));

    const open = items.filter((i) => i.status === "open").length;

    return (
      <div className="space-y-6">
        <PageHeader title="الاقتراحات والشكاوى"
          description={open > 0 ? `${open} رسالة جديدة محتاجة رد.` : "كل اللي وصل من العملاء."} />
        <FeedbackInbox items={items} />
      </div>
    );
  });
}
