-- Defense-in-depth for the double-entry invariant: a DB-level guarantee that every
-- POSTED journal entry balances (Σdebit = Σcredit), so the invariant survives any code
-- path that writes lines and posts WITHOUT going through postDraft's app-layer check.
--
-- DEFERRABLE INITIALLY DEFERRED → checked at COMMIT, not per-statement, so an entry can
-- be built up line-by-line mid-transaction. DRAFT entries are exempt (they are balanced
-- only at post time — recurring templates insert unbalanced drafts by design).

CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  je_id text;
  je_status text;
  d numeric;
  c numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    je_id := NEW.id;
  ELSE
    je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  END IF;

  SELECT status INTO je_status FROM journal_entries WHERE id = je_id;
  -- Entry gone (whole entry deleted this tx) or not yet POSTED → nothing to enforce.
  IF je_status IS DISTINCT FROM 'POSTED' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0) INTO d, c
  FROM journal_entry_lines WHERE journal_entry_id = je_id;

  IF round(d, 2) <> round(c, 2) THEN
    RAISE EXCEPTION 'journal entry % not balanced: debit=% credit=%', je_id, d, c
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS je_balanced_lines ON journal_entry_lines;
CREATE CONSTRAINT TRIGGER je_balanced_lines
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();

DROP TRIGGER IF EXISTS je_balanced_entry ON journal_entries;
CREATE CONSTRAINT TRIGGER je_balanced_entry
  AFTER INSERT OR UPDATE OF status ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();
