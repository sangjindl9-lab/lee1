-- 세금계산서 중복 수집 방지: 같은 회사·같은 방향의 같은 문서(승인번호 또는 내용 조합)는 하나만
CREATE UNIQUE INDEX tax_invoice_dedupe_uq ON tax_invoice (company_id, direction, dedupe_key) WHERE status <> 'CANCELLED';
--> statement-breakpoint
CREATE UNIQUE INDEX tax_invoice_approval_uq ON tax_invoice (company_id, direction, approval_no) WHERE approval_no IS NOT NULL AND status <> 'CANCELLED';
--> statement-breakpoint
ALTER TABLE tax_invoice ADD CONSTRAINT tax_invoice_sum_ck CHECK (total_amount = supply_amount + vat_amount);
--> statement-breakpoint
-- 테스트 모드로 발행한 계산서는 국세청 전송 완료로 표시될 수 없다
ALTER TABLE tax_invoice ADD CONSTRAINT tax_invoice_test_mode_ck CHECK (NOT (provider_mode = 'TEST' AND nts_status = 'SENT'));
--> statement-breakpoint
-- 같은 검수·기성을 여러 계산서에 이중으로 매칭하지 않도록 (부분 매칭은 금액으로 관리)
CREATE OR REPLACE FUNCTION tax_match_guard() RETURNS trigger AS $$
DECLARE src_supply numeric; used numeric;
BEGIN
  IF NEW.source_type = 'RECEIPT' THEN
    SELECT supply_amount INTO src_supply FROM goods_receipt WHERE id = NEW.source_id AND status = 'CONFIRMED';
  ELSE
    RETURN NEW;
  END IF;
  IF src_supply IS NULL THEN RAISE EXCEPTION '취소되었거나 없는 검수입니다' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(SUM(m.supply_amount),0) INTO used FROM tax_invoice_match m JOIN tax_invoice t ON t.id = m.invoice_id
    WHERE m.source_type = NEW.source_type AND m.source_id = NEW.source_id AND t.status <> 'CANCELLED' AND m.id <> NEW.id;
  IF used + NEW.supply_amount > src_supply THEN
    RAISE EXCEPTION '이 검수 금액(%)보다 많이 세금계산서에 연결할 수 없습니다 (이미 연결 %)', src_supply, used USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tax_match_guard BEFORE INSERT OR UPDATE ON tax_invoice_match FOR EACH ROW EXECUTE FUNCTION tax_match_guard();
--> statement-breakpoint
-- 같은 파일을 두 번 스캔 등록하지 않도록 (반려된 것은 제외)
CREATE UNIQUE INDEX document_file_uq ON document (company_id, file_sha256) WHERE status <> 'REJECTED';
