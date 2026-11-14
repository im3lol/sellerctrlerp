import type { ErpPermission } from "./permissions";

export const ATTACHMENT_POLICIES: { prefixes: string[]; view: ErpPermission; write: ErpPermission }[] = [
  { prefixes: ["SALES"], view: "sales.view", write: "sales.edit" },
  { prefixes: ["PURCHASE"], view: "purchases.view", write: "purchases.edit" },
  { prefixes: ["STOCK", "ITEM", "GOODS", "ADJUST", "TRANSFER"], view: "inventory.view", write: "inventory.edit" },
];

export function attachmentPermissions(entityType: string): { view: ErpPermission; write: ErpPermission } {
  return ATTACHMENT_POLICIES.find(p => p.prefixes.some(prefix => entityType.toUpperCase().startsWith(prefix)))
    ?? { view: "accounting.view", write: "accounting.create" };
}
