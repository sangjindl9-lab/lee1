-- 2회차: 서버 실행에 필요한 보조 테이블

-- 테스트 결제 시뮬레이터(외부 결제 사업자 역할). 실제 사업자 연동 시에는 쓰지 않는다.
CREATE TABLE simpg_payments (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  amount BIGINT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  refunded BIGINT NOT NULL DEFAULT 0,
  hold BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE simpg_refunds (
  idem_key TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE simpg_payouts (
  idem_key TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE simpg_events (
  seq BIGSERIAL PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 지식재산권 거래의 협의 조건 메모와 비공개 자료 열람 기록
ALTER TABLE ip_deals ADD COLUMN terms TEXT NOT NULL DEFAULT '';
CREATE TABLE ip_room_views (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES ip_listings(id),
  file_id BIGINT NOT NULL REFERENCES files(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
