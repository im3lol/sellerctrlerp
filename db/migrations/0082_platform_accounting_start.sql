-- Go-Live: the date a platform's marketplace accounting starts. Settlement
-- transactions dated before this are treated as historical (not posted to GL —
-- covered by the platform wallet's opening balance), and the order sync won't
-- pull anything older.
ALTER TABLE sales_platforms ADD COLUMN IF NOT EXISTS accounting_start_date date;
