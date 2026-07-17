import { asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { holidays } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { HolidaysManager } from "@/components/erp/holidays-manager";

export default async function HolidaysPage() {
  return loadErpPage("hr.view", async ({ orgId, can }) => {
    const rows = await db.select({ id: holidays.id, date: holidays.date, nameAr: holidays.nameAr })
      .from(holidays).where(eq(holidays.organizationId, orgId)).orderBy(asc(holidays.date));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="CalendarOff" title="تقويم العطلات الرسمية" subtitle={`${rows.length} عطلة — تُستثنى من أيام العمل`} backHref="/erp/hr/leaves" />
        <HolidaysManager holidays={rows.map((r) => ({ id: r.id, date: r.date as unknown as string, nameAr: r.nameAr }))} canManage={can("hr.create")} />
      </div>
    );
  });
}
