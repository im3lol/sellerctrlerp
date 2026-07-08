/** Round to 2 decimals (money). */
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Round to 4 decimals (quantities / unit costs). */
export const round4 = (n: number): number => Math.round(n * 10000) / 10000;
