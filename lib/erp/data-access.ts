import type { ErpPermission } from "./permissions";
import type { DocRow, OrderDetail } from "./mobile-lists";
import type { ExportDataset } from "./export-datasets";

export type PermissionCheck = (permission: ErpPermission) => boolean;

/** Same cost policy as the warehouse receipt screen. Apply before serialization. */
export const canReadPurchaseCosts = (can: PermissionCheck): boolean =>
  can("purchases.create") || can("accounting.view");

export const canExportDataset = (dataset: ExportDataset, can: PermissionCheck): boolean =>
  can(dataset.module) && (!dataset.purchaseCosts || canReadPurchaseCosts(can));

export function purchaseRowsForCaller(rows: DocRow[], can: PermissionCheck): DocRow[] {
  return canReadPurchaseCosts(can) ? rows : rows.map((r) => ({ ...r, amount: null }));
}

export function purchaseOrderForCaller(detail: OrderDetail, can: PermissionCheck) {
  if (canReadPurchaseCosts(can)) return detail;
  // Allowlist operational fields: future financial properties cannot leak by spread.
  return {
    id: detail.id, number: detail.number, party: detail.party, date: detail.date,
    status: detail.status, total: null,
    lines: detail.lines.map((l) => ({ name: l.name, qty: l.qty, unitPrice: null, total: null })),
  };
}
