import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";

// Amazon order import now lives inside the platform page. Redirect the legacy URL
// to the Amazon platform's import hub (or the platforms list to create it).
export default async function LegacyAmazonImportPage() {
  const { orgId } = await requireErpModule("sales.create");
  const [p] = await db.select({ code: salesPlatforms.code }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, "AMAZON"))).limit(1);
  redirect(p ? `/erp/platforms/${p.code.toLowerCase()}/import` : "/erp/platforms");
}
