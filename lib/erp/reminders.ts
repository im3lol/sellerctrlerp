/**
 * Overdue-invoice reminders — the pure half. A company picks the days after the due date
 * it wants to remind a customer (3 / 10 / 20 by default); each stage is sent once, tracked
 * on the invoice (sales_invoices.reminder_stage). Kept in approvalPolicy.reminders beside
 * the stuck-document limits, so the setting needed no migration of its own.
 */

export type ReminderPolicy = { enabled: boolean; stages: number[] };
export const DEFAULT_REMINDER_STAGES = [3, 10, 20];

/** Whatever is stored → a usable policy: off unless switched on, stages sorted and sane. */
export function parseReminderPolicy(raw: unknown): ReminderPolicy {
  const r = (raw && typeof raw === "object" ? (raw as { reminders?: unknown }).reminders : undefined) as
    { enabled?: unknown; stages?: unknown } | undefined;
  const stages = Array.isArray(r?.stages)
    ? [...new Set(r.stages.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => a - b)
    : [];
  return { enabled: r?.enabled === true, stages: stages.length ? stages : DEFAULT_REMINDER_STAGES };
}

/**
 * The stage to send now: the latest one the invoice has reached, if it's beyond the last
 * one sent. A run that was missed doesn't send the stages it skipped — only the current one,
 * so a customer never gets three emails in one morning.
 */
export function reminderDue(daysOverdue: number, stages: number[], lastSent: number): number | null {
  const reached = stages.filter((s) => daysOverdue >= s && s > 0);
  if (reached.length === 0) return null;
  const stage = Math.max(...reached);
  return stage > lastSent ? stage : null;
}
