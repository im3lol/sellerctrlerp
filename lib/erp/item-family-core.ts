// Pure guard for linking an item as a variation (child) under a parent item.
// One level only (Amazon parent→child): the parent must not itself be a child,
// and a child that already has its own variations cannot become someone's child.
// No db here so it is unit-testable; the action supplies the queried facts.

export function validateParentLink(opts: {
  childId: string;
  parentId: string;
  parentExists: boolean; // parent row found AND in the same org
  parentHasParent: boolean; // the chosen parent is itself a variation
  childHasChildren: boolean; // this item already heads a variation family
}): string | null {
  const { childId, parentId, parentExists, parentHasParent, childHasChildren } = opts;
  if (!parentId) return null; // unlinking is always allowed
  if (parentId === childId) return "لا يمكن ربط الصنف بنفسه";
  if (!parentExists) return "المنتج الأب غير موجود";
  if (parentHasParent) return "المنتج الأب هو نفسه تنويعة — يُسمح بمستوى واحد فقط";
  if (childHasChildren) return "هذا الصنف أب لتنويعات — لا يمكن جعله تنويعة تحت صنف آخر";
  return null;
}
