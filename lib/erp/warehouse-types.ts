// Warehouse hierarchy level types + their Arabic labels. Shared by the action,
// the export, and the tree UI (a "use server" file can't export these consts).
export const WAREHOUSE_TYPES = ["WAREHOUSE", "ZONE", "RACK", "SHELF", "BOX"] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export const WAREHOUSE_TYPE_LABEL: Record<string, string> = {
  WAREHOUSE: "مخزن", ZONE: "منطقة", RACK: "ممر", SHELF: "رف", BOX: "صندوق",
};
export const LABEL_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(WAREHOUSE_TYPE_LABEL).map(([k, v]) => [v, k]),
);
