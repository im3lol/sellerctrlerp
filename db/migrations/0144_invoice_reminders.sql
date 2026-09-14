-- Overdue reminders (lib/erp/reminders.ts): the last reminder stage (days after the due
-- date) already sent for this invoice, so each stage goes out once. 0 = none yet.
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "reminder_stage" integer DEFAULT 0 NOT NULL;
