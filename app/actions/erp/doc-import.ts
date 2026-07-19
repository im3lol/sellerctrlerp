"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { authorizeErp } from "@/lib/erp/action-auth";
import { importSalesOrdersCore, importPurchaseOrdersCore, importStockTransfersCore, type DocImportResult } from "@/lib/erp/doc-import-core";

// Thin auth wrappers around the DRAFT importers. All logic lives in the core module
// (lib/erp/doc-import-core.ts) so it can be unit/integration-tested headless.

export async function importSalesOrdersCSV(csvText: string): Promise<DocImportResult | { error: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await importSalesOrdersCore(auth.orgId, auth.userId, csvText);
    revalidatePath("/sales/orders");
    return r;
  });
}

export async function importPurchaseOrdersCSV(csvText: string): Promise<DocImportResult | { error: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await importPurchaseOrdersCore(auth.orgId, auth.userId, csvText);
    revalidatePath("/purchases/orders");
    return r;
  });
}

export async function importStockTransfersCSV(csvText: string): Promise<DocImportResult | { error: string }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await importStockTransfersCore(auth.orgId, auth.userId, csvText);
    revalidatePath("/inventory/transfers");
    return r;
  });
}
