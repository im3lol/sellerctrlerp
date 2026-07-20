/** Split an array into slices of at most `size`. Used to bound multi-row INSERTs
 *  so a big batch (e.g. an 11k-product Amazon import) doesn't blow the JS call
 *  stack in the query builder or Postgres's 65,535 bind-param ceiling. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
