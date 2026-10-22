-- 감사로그는 추가만 가능. 수정·삭제를 데이터베이스 수준에서 차단한다.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '감사로그는 수정하거나 삭제할 수 없습니다 (audit_log is append-only)';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
-- 금액 무결성: 계약총액 = 공급가액 + 부가세 (서버 검증과 이중 차단)
ALTER TABLE project ADD CONSTRAINT project_amount_sum_ck
  CHECK (total_amount = supply_amount + vat_amount);
--> statement-breakpoint
ALTER TABLE project ADD CONSTRAINT project_amount_nonneg_ck
  CHECK (supply_amount >= 0 AND vat_amount >= 0 AND execution_budget >= 0);
--> statement-breakpoint
ALTER TABLE project ADD CONSTRAINT project_progress_range_ck
  CHECK (progress_rate >= 0 AND progress_rate <= 1);
--> statement-breakpoint
-- 사업자등록번호는 숫자 10자리만 저장
ALTER TABLE company ADD CONSTRAINT company_bizreg_ck CHECK (biz_reg_no ~ '^[0-9]{10}$');
--> statement-breakpoint
ALTER TABLE vendor ADD CONSTRAINT vendor_bizreg_ck CHECK (biz_reg_no IS NULL OR biz_reg_no ~ '^[0-9]{10}$');
--> statement-breakpoint
-- 같은 회사 안에서 삭제되지 않은 거래처의 사업자번호 중복 금지
CREATE UNIQUE INDEX vendor_company_bizreg_live_uq ON vendor (company_id, biz_reg_no)
  WHERE deleted_at IS NULL AND biz_reg_no IS NOT NULL;
