// Keep axes short; tooltips retain the full label and precise value.
export function shortChartLabel(label: string, limit = 18): string {
  const chars = Array.from(label);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : label;
}

export function chartAxisNumber(value: number): string {
  return Number(value).toLocaleString("en-GB", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  });
}
