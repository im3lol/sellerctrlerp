/** Relative time in Arabic, e.g. "قبل ٣ دقائق". */
export function relativeTimeAr(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);

  if (diff < 60) return "الآن";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `قبل ${m} دقيقة`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `قبل ${h} ساعة`;
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `قبل ${days} يوم`;
  }
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(d);
}

/** Absolute date in Arabic. */
export function formatDateAr(date: Date | string, withTime = false): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(d);
}

/** Number formatting with Arabic locale grouping. */
export function formatNumberAr(n: number): string {
  return new Intl.NumberFormat("ar").format(n);
}
