/** Pure recurring-schedule constants + math — no DB imports, safe in client components. */
export type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
export const FREQUENCIES: Frequency[] = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: "أسبوعي", MONTHLY: "شهري", QUARTERLY: "ربع سنوي", YEARLY: "سنوي",
};

/** Next occurrence after `from` for a frequency (pure). Month math uses JS
 *  setMonth, which rolls a short month forward (e.g. Jan 31 → Mar 3). */
export function advance(from: Date, freq: Frequency): Date {
  const d = new Date(from);
  if (freq === "WEEKLY") d.setDate(d.getDate() + 7);
  else if (freq === "MONTHLY") d.setMonth(d.getMonth() + 1);
  else if (freq === "QUARTERLY") d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}
