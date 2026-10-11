-- Custom migration: database-level safety net for expense totals (ARCHITECTURE.md section 4).
-- At commit time, for every expense touched in the transaction:
--   SUM(expense_payers) = SUM(expense_shares) = expenses.amount_minor
-- The service layer validates first; this catches bugs. The triggers are DEFERRABLE INITIALLY
-- DEFERRED so that an expense and its rows can be written in any order inside one transaction.
CREATE FUNCTION check_expense_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id uuid;
  expected  bigint;
  paid      bigint;
  owed      bigint;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    target_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target_id := OLD.expense_id;
  ELSE
    target_id := NEW.expense_id;
  END IF;

  SELECT amount_minor INTO expected FROM expenses WHERE id = target_id;
  IF NOT FOUND THEN
    RETURN NULL; -- the expense itself was removed (cascade); nothing left to check
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0) INTO paid FROM expense_payers WHERE expense_id = target_id;
  SELECT COALESCE(SUM(amount_minor), 0) INTO owed FROM expense_shares WHERE expense_id = target_id;

  IF paid <> expected OR owed <> expected THEN
    RAISE EXCEPTION 'expense % does not add up: amount %, payers %, shares %',
      target_id, expected, paid, owed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expenses_totals_check
  AFTER INSERT OR UPDATE OF amount_minor ON expenses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_totals();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_payers_totals_check
  AFTER INSERT OR UPDATE OR DELETE ON expense_payers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_totals();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_shares_totals_check
  AFTER INSERT OR UPDATE OR DELETE ON expense_shares
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_totals();
