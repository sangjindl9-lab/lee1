-- 발주 금액 무결성
ALTER TABLE purchase_order ADD CONSTRAINT po_amount_sum_ck CHECK (total_amount = supply_amount + vat_amount);
--> statement-breakpoint
ALTER TABLE purchase_order_line ADD CONSTRAINT po_line_qty_ck CHECK (qty > 0 AND unit_price >= 0);
--> statement-breakpoint
-- 검수 수량은 발주 수량을 넘을 수 없고 음수가 될 수 없다 (동시 검수 시 최종 방어선)
ALTER TABLE purchase_order_line ADD CONSTRAINT po_line_received_ck CHECK (received_qty >= 0 AND received_qty <= qty);
--> statement-breakpoint
ALTER TABLE goods_receipt_line ADD CONSTRAINT gr_line_qty_ck CHECK (qty > 0);
--> statement-breakpoint
-- 한 문서에 진행 중인 결재는 하나만
CREATE UNIQUE INDEX approval_active_doc_uq ON approval (doc_type, doc_id) WHERE status IN ('PENDING', 'HOLD');
--> statement-breakpoint
-- 결재 기록은 삭제할 수 없다 (취소는 상태로 처리)
CREATE OR REPLACE FUNCTION approval_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '결재 기록은 삭제할 수 없습니다';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approval_no_delete BEFORE DELETE ON approval FOR EACH ROW EXECUTE FUNCTION approval_no_delete();
--> statement-breakpoint
CREATE TRIGGER approval_step_no_delete BEFORE DELETE ON approval_step FOR EACH ROW EXECUTE FUNCTION approval_no_delete();
--> statement-breakpoint
-- 처리 완료된 결재 단계는 다시 바꿀 수 없다
CREATE OR REPLACE FUNCTION approval_step_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION '이미 처리된 결재 단계는 변경할 수 없습니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approval_step_lock BEFORE UPDATE ON approval_step FOR EACH ROW EXECUTE FUNCTION approval_step_immutable();
--> statement-breakpoint
-- 기존 회사에 발주서 기본 결재선(대표이사 승인) 등록
INSERT INTO approval_line (company_id, doc_type, min_amount, steps)
SELECT id, 'PURCHASE_ORDER', 0, '[{"title":"승인","roleKey":"CEO"}]'::jsonb FROM company
ON CONFLICT DO NOTHING;
