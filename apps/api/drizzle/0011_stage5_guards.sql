ALTER TABLE bank_transaction ADD CONSTRAINT bank_tx_ck CHECK (amount > 0 AND direction IN ('IN', 'OUT') AND status IN ('UNMATCHED', 'MATCHED', 'IGNORED'));
--> statement-breakpoint
-- 같은 지급·수금을 두 통장 거래에 중복으로 맞추지 않도록
CREATE UNIQUE INDEX bank_tx_matched_uq ON bank_transaction (matched_type, matched_id) WHERE status = 'MATCHED' AND matched_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE webhook_delivery ADD CONSTRAINT webhook_delivery_ck CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED'));
--> statement-breakpoint
-- API 키는 해시만 저장 (원문 형식 저장 방지)
ALTER TABLE api_credential ADD CONSTRAINT api_credential_hash_ck CHECK (key_hash ~ '^[0-9a-f]{64}$');
