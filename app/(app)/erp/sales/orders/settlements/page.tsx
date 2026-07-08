import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";

// Amazon settlements now live inside the platform page (التسويات tab). Redirect the
// legacy URL to the Amazon platform's import hub (or the platforms list to create it).
export default async function LegacyAmazonSettlementsPage() {
  const { orgId } = await requireErpModule("accounting.create");
  const [p] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, "AMAZON"))).limit(1);
  redirect(p ? `/erp/platforms/${p.id}/import` : "/erp/platforms");
}
