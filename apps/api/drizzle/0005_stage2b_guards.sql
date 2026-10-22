-- ═══ 전표 무결성 ═══
ALTER TABLE journal_line ADD CONSTRAINT jl_amount_ck CHECK (debit >= 0 AND credit >= 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)));
--> statement-breakpoint
-- 차변 합계 = 대변 합계 (트랜잭션 끝에서 검사 — 한 줄씩 넣는 중간 상태는 허용)
CREATE OR REPLACE FUNCTION je_balance_check() RETURNS trigger AS $$
DECLARE
  eid uuid;
  d numeric; c numeric; n int; st journal_status; hd numeric; hc numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entry' THEN
    eid := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    eid := OLD.entry_id;
  ELSE
    eid := NEW.entry_id;
  END IF;
  SELECT status, total_debit, total_credit INTO st, hd, hc FROM journal_entry WHERE id = eid;
  IF st IS NULL OR st = 'VOID' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n FROM journal_line WHERE entry_id = eid;
  IF n < 2 THEN RAISE EXCEPTION '전표는 2줄 이상이어야 합니다' USING ERRCODE = 'P0001'; END IF;
  IF d <> c THEN RAISE EXCEPTION '차변 합계(%)와 대변 합계(%)가 일치하지 않습니다', d, c USING ERRCODE = 'P0001'; END IF;
  IF d <> hd OR c <> hc THEN RAISE EXCEPTION '전표 합계가 분개 줄 합계와 다릅니다' USING ERRCODE = 'P0001'; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER jl_balance AFTER INSERT OR UPDATE OR DELETE ON journal_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION je_balance_check();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER je_balance AFTER INSERT OR UPDATE ON journal_entry DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION je_balance_check();
--> statement-breakpoint
-- 승인된 전표의 분개 줄은 바꿀 수 없다
CREATE OR REPLACE FUNCTION jl_lock() RETURNS trigger AS $$
DECLARE st journal_status;
BEGIN
  SELECT status INTO st FROM journal_entry WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF st IN ('APPROVED', 'REVERSED') THEN
    RAISE EXCEPTION '승인된 전표는 수정·삭제할 수 없습니다. 역분개로 취소하세요' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jl_lock BEFORE INSERT OR UPDATE OR DELETE ON journal_line FOR EACH ROW EXECUTE FUNCTION jl_lock();
--> statement-breakpoint
-- 전표 머리: 삭제 금지, 승인 후에는 역분개 표시 외 변경 금지, 마감 기간 기록 금지
CREATE OR REPLACE FUNCTION je_guard() RETURNS trigger AS $$
DECLARE locked boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '전표는 삭제할 수 없습니다 (작성중 전표는 무효 처리)' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('REVERSED', 'VOID') THEN
      RAISE EXCEPTION '취소된 전표는 변경할 수 없습니다' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'APPROVED' THEN
      IF NOT (NEW.status = 'REVERSED' AND NEW.entry_date = OLD.entry_date AND NEW.total_debit = OLD.total_debit AND NEW.total_credit = OLD.total_credit AND NEW.description = OLD.description) THEN
        RAISE EXCEPTION '승인된 전표는 수정할 수 없습니다. 역분개로 취소하세요' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW; -- 역분개 표시는 마감 기간이어도 허용 (역분개 전표는 열린 기간에 기록됨)
    END IF;
  END IF;
  SELECT status = 'CLOSED' INTO locked FROM accounting_period WHERE company_id = NEW.company_id AND period = to_char(NEW.entry_date, 'YYYY-MM');
  IF locked THEN
    RAISE EXCEPTION '% 은(는) 마감된 기간입니다. 마감을 해제하거나 열린 기간의 날짜로 처리하세요', to_char(NEW.entry_date, 'YYYY-MM') USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.entry_date <> NEW.entry_date THEN
    SELECT status = 'CLOSED' INTO locked FROM accounting_period WHERE company_id = OLD.company_id AND period = to_char(OLD.entry_date, 'YYYY-MM');
    IF locked THEN RAISE EXCEPTION '마감된 기간의 전표는 옮길 수 없습니다' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER je_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entry FOR EACH ROW EXECUTE FUNCTION je_guard();
--> statement-breakpoint
-- 같은 원천문서·같은 목적의 분개는 하나만 (중복 분개 방지)
CREATE UNIQUE INDEX je_source_purpose_uq ON journal_entry (company_id, source_type, source_id, purpose) WHERE source_id IS NOT NULL AND status <> 'VOID';
--> statement-breakpoint
-- ═══ 지급결의·지급 ═══
ALTER TABLE payment_request ADD CONSTRAINT payreq_sum_ck CHECK (total_amount = supply_amount + vat_amount AND supply_amount >= 0 AND vat_amount >= 0);
--> statement-breakpoint
ALTER TABLE payment_request_line ADD CONSTRAINT payreq_line_sum_ck CHECK (total_amount = supply_amount + vat_amount AND supply_amount >= 0 AND vat_amount >= 0);
--> statement-breakpoint
ALTER TABLE payment ADD CONSTRAINT payment_amount_ck CHECK (amount > 0);
--> statement-breakpoint
-- 하나의 지급결의에는 유효한 지급이 하나만 (중복 지급 방지)
CREATE UNIQUE INDEX payment_request_once_uq ON payment (request_id) WHERE status = 'CONFIRMED';
--> statement-breakpoint
-- 결재 승인되지 않은 지급결의는 지급할 수 없다 (서버 검사와 별개로 DB 에서 한 번 더)
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger AS $$
DECLARE st payment_request_status; tot numeric;
BEGIN
  SELECT status, total_amount INTO st, tot FROM payment_request WHERE id = NEW.request_id FOR UPDATE;
  IF st IS DISTINCT FROM 'APPROVED' THEN
    RAISE EXCEPTION '결재 승인된 지급결의만 지급할 수 있습니다' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount <> tot THEN
    RAISE EXCEPTION '지급액이 지급결의 금액과 다릅니다' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_guard BEFORE INSERT ON payment FOR EACH ROW EXECUTE FUNCTION payment_guard();
--> statement-breakpoint
-- ═══ 실행예산 ═══
ALTER TABLE project_budget ADD CONSTRAINT budget_amount_ck CHECK (amount >= 0);
--> statement-breakpoint
ALTER TABLE budget_revision_line ADD CONSTRAINT budget_rev_line_ck CHECK (before_amount >= 0 AND after_amount >= 0);
--> statement-breakpoint
ALTER TABLE purchase_request_line ADD CONSTRAINT pr_line_qty_ck CHECK (qty > 0);
