-- 변경계약 회차는 현장별로 하나 (취소된 것 제외)
CREATE UNIQUE INDEX contract_revision_no_uq ON contract_revision (project_id, revision_no) WHERE status <> 'CANCELLED';
--> statement-breakpoint
-- 기성 회차는 현장별로 하나, 하도급 기성 회차는 계약별로 하나
CREATE UNIQUE INDEX progress_claim_no_uq ON progress_claim (project_id, claim_no) WHERE status NOT IN ('CANCELLED', 'REJECTED');
--> statement-breakpoint
CREATE UNIQUE INDEX sub_claim_no_uq ON sub_claim (subcontract_id, claim_no) WHERE status NOT IN ('CANCELLED', 'REJECTED');
--> statement-breakpoint
-- 기성 금액 규칙
ALTER TABLE progress_claim ADD CONSTRAINT progress_claim_amount_ck CHECK (
  this_supply > 0 AND advance_deduction >= 0 AND retention_amount >= 0 AND vat_amount >= 0
  AND cumulative = prev_cumulative + this_supply
  AND receivable_amount = this_supply + vat_amount - advance_deduction - retention_amount
  AND advance_deduction + retention_amount <= this_supply);
--> statement-breakpoint
ALTER TABLE sub_claim ADD CONSTRAINT sub_claim_amount_ck CHECK (
  this_amount > 0 AND retention_amount >= 0 AND vat_amount >= 0 AND cumulative = prev_cumulative + this_amount
  AND payable_amount = this_amount + vat_amount - retention_amount AND retention_amount <= this_amount);
--> statement-breakpoint
ALTER TABLE collection ADD CONSTRAINT collection_amount_ck CHECK (amount > 0);
--> statement-breakpoint
ALTER TABLE collection ADD CONSTRAINT collection_status_ck CHECK (status IN ('CONFIRMED', 'CANCELLED'));
--> statement-breakpoint
ALTER TABLE labor_record ADD CONSTRAINT labor_record_ck CHECK (amount >= 0 AND man_days >= 0 AND man_days <= 3 AND overtime_hours >= 0 AND overtime_hours <= 16 AND status IN ('RECORDED', 'CONFIRMED', 'CANCELLED'));
--> statement-breakpoint
-- 같은 작업자가 같은 날 같은 현장에 두 번 기록되지 않도록
CREATE UNIQUE INDEX labor_record_once_uq ON labor_record (worker_id, project_id, work_date) WHERE status <> 'CANCELLED';
--> statement-breakpoint
-- 기성 누적이 계약금액을 넘지 않도록 (승인된·진행 중 기성 기준, 변경계약 승인분 포함)
CREATE OR REPLACE FUNCTION progress_claim_guard() RETURNS trigger AS $$
DECLARE contract numeric; claimed numeric;
BEGIN
  IF NEW.status IN ('CANCELLED', 'REJECTED') THEN RETURN NEW; END IF;
  SELECT p.supply_amount + COALESCE((SELECT SUM(delta_amount) FROM contract_revision r WHERE r.project_id = p.id AND r.status = 'APPROVED'), 0)
    INTO contract FROM project p WHERE p.id = NEW.project_id;
  SELECT COALESCE(SUM(this_supply), 0) INTO claimed FROM progress_claim
    WHERE project_id = NEW.project_id AND status NOT IN ('CANCELLED', 'REJECTED') AND id <> NEW.id;
  IF claimed + NEW.this_supply > contract THEN
    RAISE EXCEPTION '누적 기성(%)이 계약금액(%)을 넘습니다. 변경계약을 먼저 승인받으세요', claimed + NEW.this_supply, contract USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER progress_claim_guard BEFORE INSERT OR UPDATE OF this_supply, status ON progress_claim FOR EACH ROW EXECUTE FUNCTION progress_claim_guard();
--> statement-breakpoint
-- 하도급 기성 누적이 하도급 계약금액을 넘지 않도록
CREATE OR REPLACE FUNCTION sub_claim_guard() RETURNS trigger AS $$
DECLARE amt numeric; claimed numeric;
BEGIN
  IF NEW.status IN ('CANCELLED', 'REJECTED') THEN RETURN NEW; END IF;
  SELECT current_amount INTO amt FROM subcontract WHERE id = NEW.subcontract_id;
  SELECT COALESCE(SUM(this_amount), 0) INTO claimed FROM sub_claim WHERE subcontract_id = NEW.subcontract_id AND status NOT IN ('CANCELLED', 'REJECTED') AND id <> NEW.id;
  IF claimed + NEW.this_amount > amt THEN
    RAISE EXCEPTION '하도급 기성 누적(%)이 계약금액(%)을 넘습니다', claimed + NEW.this_amount, amt USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER sub_claim_guard BEFORE INSERT OR UPDATE OF this_amount, status ON sub_claim FOR EACH ROW EXECUTE FUNCTION sub_claim_guard();
--> statement-breakpoint
-- 수금이 청구한 금액보다 많아지지 않도록 (기성 수금)
CREATE OR REPLACE FUNCTION collection_guard() RETURNS trigger AS $$
DECLARE due numeric; got numeric;
BEGIN
  IF NEW.status <> 'CONFIRMED' OR NEW.claim_id IS NULL THEN RETURN NEW; END IF;
  SELECT receivable_amount INTO due FROM progress_claim WHERE id = NEW.claim_id AND status IN ('APPROVED', 'INVOICED', 'PARTIAL', 'COLLECTED');
  IF due IS NULL THEN RAISE EXCEPTION '승인되지 않은 기성에는 수금을 연결할 수 없습니다' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO got FROM collection WHERE claim_id = NEW.claim_id AND status = 'CONFIRMED' AND id <> NEW.id;
  IF got + NEW.amount > due THEN
    RAISE EXCEPTION '수금 합계(%)가 청구액(%)을 넘습니다', got + NEW.amount, due USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER collection_guard BEFORE INSERT OR UPDATE ON collection FOR EACH ROW EXECUTE FUNCTION collection_guard();
--> statement-breakpoint
-- 정산 완료(유효) 기록은 현장당 하나
CREATE UNIQUE INDEX project_settlement_active_uq ON project_settlement (project_id) WHERE status = 'SETTLED';
