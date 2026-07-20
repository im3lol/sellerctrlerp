import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import type { PrintOrg } from "@/components/erp/print/document-sheet";

/**
 * The letterhead + the currency every printed document needs.
 *
 * The org projection was copy-pasted into all six print pages; the currency was
 * fetched by none of them, which is how a receipt ended up printing ﷼ next to an EGP
 * amount. Bundling them means a new print page cannot forget the currency.
 */
export async function loadPrintHeader(orgId: string): Promise<{ org: PrintOrg | undefined; currency: string }> {
  const [rows, currency] = await Promise.all([
    db
      .select({
        nameAr: organizations.nameAr,
        address: organizations.address,
        phone: organizations.phone,
        taxNumber: organizations.taxNumber,
        logo: organizations.logo,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1),
    getBaseCurrencyCode(orgId),
  ]);
  return { org: rows[0], currency };
}
