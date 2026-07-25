import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { resolvePrintSettings } from "@/lib/erp/print-settings";
import type { PrintOrg } from "@/components/erp/print/document-sheet";

/**
 * The letterhead + the currency every printed document needs.
 *
 * The org projection was copy-pasted into all six print pages; the currency was
 * fetched by none of them, which is how a receipt ended up printing ﷼ next to an EGP
 * amount. Bundling them means a new print page cannot forget the currency.
 *
 * The org's print settings (settings → إعدادات الطباعة) are applied HERE, so every
 * print route honors the letterhead preferences with zero per-route code: hidden
 * fields come back null, the display-name override replaces nameAr, showLogo:false
 * sets `noLogo`. Column hiding is per-document — routes pass `hiddenFor(docKey)`.
 */
export async function loadPrintHeader(orgId: string): Promise<{
  org: PrintOrg | undefined;
  currency: string;
  hiddenFor: (docKey: string) => string[];
  footerText: string | undefined;
}> {
  const [rows, currency] = await Promise.all([
    db
      .select({
        nameAr: organizations.nameAr,
        address: organizations.address,
        phone: organizations.phone,
        taxNumber: organizations.taxNumber,
        logo: organizations.logo,
        printSettings: organizations.printSettings,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1),
    getBaseCurrencyCode(orgId),
  ]);
  const row = rows[0];
  const { header, docs } = resolvePrintSettings(row?.printSettings);
  const org: PrintOrg | undefined = row && {
    nameAr: header.displayName ?? row.nameAr,
    address: header.showAddress ? row.address : null,
    phone: header.showPhone ? row.phone : null,
    taxNumber: header.showTaxNumber ? row.taxNumber : null,
    logo: header.showLogo ? row.logo : null,
    noLogo: !header.showLogo,
  };
  return { org, currency, hiddenFor: (docKey) => docs[docKey] ?? [], footerText: header.footerText };
}
