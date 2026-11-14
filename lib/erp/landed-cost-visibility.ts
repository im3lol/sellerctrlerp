/** A reserved draft also counts, so starting a new voucher cannot silently double-charge it. */
export function hasPriorLandedCost(line: {
  previousPerUnit: number;
  vouchers: { id: string; perUnit: number }[];
}, editingId?: string) {
  return line.previousPerUnit !== 0 || line.vouchers.some(v => v.id !== editingId && v.perUnit > 0);
}

export function matchesLandedSearch(query: string, ...values: string[]) {
  const q = query.trim().toLocaleLowerCase();
  return !!q && values.join(" ").toLocaleLowerCase().includes(q);
}
