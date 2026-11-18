-- 이음마켓 EUM MARKET — 전체 스키마 (1회차)
-- 원칙
--  · 금액은 모두 원(KRW 최소 단위) 정수 BIGINT.
--  · 주문의 의미는 7개 상태 컬럼으로 분리한다(결제·대금 보호·납품·검수·분쟁·환불·판매자 지급).
--  · 플랫폼 내부 상태와 외부 결제 사업자 상태는 별도 컬럼으로 기록하고 대사(recon)로 비교한다.
--  · 주문 시점 조건(납품 버전·설명·권리·금액·수수료)은 불변. 원장·감사 로그는 추가만 가능.
--  · schema.prisma 는 이 SQL에서 생성한다(scripts/gen-prisma.mjs). CHECK·트리거는 SQL에만 존재한다.

-- ───────────── 열거형 ─────────────
CREATE TYPE operator_role AS ENUM ('review','support','settlement','super');
CREATE TYPE company_role AS ENUM ('admin','buyer','inspector');
CREATE TYPE seller_status AS ENUM ('pending','approved','suspended','withdrawn');
CREATE TYPE business_type AS ENUM ('corporation','general_taxpayer','simplified_taxpayer','individual');
CREATE TYPE product_kind AS ENUM ('license','source');
CREATE TYPE product_status AS ENUM ('draft','pending_review','on_sale','rejected','suspended','withdrawn');
CREATE TYPE version_status AS ENUM ('draft','submitted','published','rejected','retired');
CREATE TYPE scan_status AS ENUM ('pending','scanning','passed','flagged','unscannable');
CREATE TYPE order_type AS ENUM ('product','milestone','ip');

-- 7대 상태
CREATE TYPE payment_status AS ENUM ('unpaid','pending','paid','partially_refunded','cancelled','failed');
CREATE TYPE escrow_status AS ENUM ('none','test_simulated','held','dispute_hold','released','refunded','unsupported');
CREATE TYPE delivery_status AS ENUM ('not_ready','submitted','granted','failed','revoked');
CREATE TYPE inspection_status AS ENUM ('not_started','in_progress','revision_requested','confirmed','auto_confirmed','disputed','closed_by_admin');
CREATE TYPE dispute_status AS ENUM ('none','open','resolved');
CREATE TYPE refund_status AS ENUM ('none','requested','processing','completed','failed','post_settlement_review');
CREATE TYPE payout_status AS ENUM ('not_eligible','eligible','requested','unknown','paid','failed','blocked','void');

CREATE TYPE capability_status AS ENUM ('unverified','confirmed','unsupported');
CREATE TYPE external_hold_status AS ENUM ('not_requested','confirmed','unsupported','failed','not_applicable');
CREATE TYPE ledger_kind AS ENUM (
  'payment_in','refund_out',
  'platform_fee_supply','platform_fee_vat',
  'pg_fee_seller','pg_fee_platform',
  'withholding_income_tax','withholding_local_tax',
  'payout_paid');
CREATE TYPE tax_doc_type AS ENUM ('tax_invoice','fee_receipt','withholding_statement');

-- ───────────── 회원·기업·판매자 ─────────────
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  operator_role operator_role,                 -- 운영자만 값이 있음
  totp_secret_enc TEXT,                        -- 관리자 추가 인증
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  stepup_at TIMESTAMPTZ,                       -- 민감 작업 재인증 시각
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  biz_reg_no_enc TEXT,
  purchase_approval_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_members (
  company_id BIGINT NOT NULL REFERENCES companies(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  role company_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE sellers (
  user_id BIGINT PRIMARY KEY REFERENCES users(id),
  display_name TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  portfolio TEXT NOT NULL DEFAULT '',
  status seller_status NOT NULL DEFAULT 'pending',
  business_type business_type NOT NULL DEFAULT 'individual',
  biz_reg_no_enc TEXT,                         -- 사업자등록번호(암호화). 주민등록번호는 저장하지 않는다
  tax_invoice_issuable BOOLEAN NOT NULL DEFAULT false, -- 판매자가 구매자에게 세금계산서를 발행할 수 있는지(간이과세자 구분)
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  payout_account_enc TEXT,
  payout_account_hint TEXT,
  payout_verified BOOLEAN NOT NULL DEFAULT false,
  payout_account_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 결제 사업자 기능 확인표(기능 플래그). confirmed 인 기능만 활성화한다.
CREATE TABLE provider_capabilities (
  provider TEXT NOT NULL,
  key TEXT NOT NULL,                           -- digital_goods, multi_seller, max_hold_days, auto_confirm, dispute_hold, partial_refund:card ...
  status capability_status NOT NULL DEFAULT 'unverified',
  value TEXT NOT NULL DEFAULT '',
  fallback TEXT NOT NULL DEFAULT '',           -- 미지원 시 대체 절차
  evidence TEXT NOT NULL DEFAULT '',           -- 계약서·공식 문서 근거
  confirmed_by BIGINT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (provider, key)
);

-- ───────────── 상품·라이선스·파일 ─────────────
CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  seller_id BIGINT NOT NULL REFERENCES users(id),
  kind product_kind NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '',
  included TEXT NOT NULL DEFAULT '',
  excluded TEXT NOT NULL DEFAULT '',
  media_urls TEXT NOT NULL DEFAULT '',
  demo_url TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  install_method TEXT NOT NULL DEFAULT '',
  has_source BOOLEAN NOT NULL DEFAULT false,
  install_support BOOLEAN NOT NULL DEFAULT false,
  install_done_criteria TEXT NOT NULL DEFAULT '',
  customizable BOOLEAN NOT NULL DEFAULT false,
  external_paid BOOLEAN NOT NULL DEFAULT false,
  external_costs TEXT NOT NULL DEFAULT '',
  third_party TEXT NOT NULL DEFAULT '',
  update_support TEXT NOT NULL DEFAULT '',
  inspection_criteria TEXT NOT NULL DEFAULT '',
  inspection_days INT NOT NULL DEFAULT 7 CHECK (inspection_days BETWEEN 1 AND 60),
  delivery_note TEXT NOT NULL DEFAULT '',
  refund_policy TEXT NOT NULL DEFAULT '',
  deliverables JSONB NOT NULL DEFAULT '[]',    -- 판매자가 약속한 제공 파일 종류 목록
  verification_scope JSONB NOT NULL DEFAULT '{}', -- 실행 확인·악성 파일 검사·권리 자료 확인을 항목별로 따로 기록
  status product_status NOT NULL DEFAULT 'draft',
  current_version_id BIGINT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 권리 조건(사용권·소스 이용 범위). 권리 양도는 지식재산권 거래에서만 다룬다.
CREATE TABLE licenses (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  term TEXT NOT NULL DEFAULT 'perpetual' CHECK (term IN ('perpetual','subscription')),
  term_months INT,
  max_users INT,
  max_devices INT,
  can_modify BOOLEAN NOT NULL DEFAULT false,
  can_commercial BOOLEAN NOT NULL DEFAULT false,
  can_redistribute BOOLEAN NOT NULL DEFAULT false,
  can_resell BOOLEAN NOT NULL DEFAULT false,
  ip_transfer BOOLEAN NOT NULL DEFAULT false CHECK (ip_transfer = false), -- 상품 구매로는 권리가 이전되지 않는다
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_options (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  license_id BIGINT NOT NULL REFERENCES licenses(id),
  name TEXT NOT NULL,
  price BIGINT NOT NULL CHECK (price > 0),
  includes_source BOOLEAN NOT NULL DEFAULT false,
  includes_install BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE requests (
  id BIGSERIAL PRIMARY KEY,
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  company_id BIGINT REFERENCES companies(id),
  base_product_id BIGINT REFERENCES products(id),  -- 기존 상품 커스터마이징이면 대상 상품
  work_type TEXT NOT NULL CHECK (work_type IN ('new','customize','install','integration','maintenance')),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  budget_min BIGINT,
  budget_max BIGINT,
  due_date DATE,
  reference_notes TEXT NOT NULL DEFAULT '',
  source_terms TEXT NOT NULL DEFAULT '',
  rights_ownership TEXT NOT NULL DEFAULT '',
  maintenance TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','contracted','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quotes (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES requests(id),
  seller_id BIGINT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL DEFAULT '',
  out_of_scope TEXT NOT NULL DEFAULT '',
  inspection_criteria TEXT NOT NULL DEFAULT '',
  revision_scope TEXT NOT NULL DEFAULT '',
  support_terms TEXT NOT NULL DEFAULT '',
  stages JSONB NOT NULL DEFAULT '[]',          -- 단계별 일정·산출물·금액 제안
  total_amount BIGINT NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','withdrawn','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT REFERENCES requests(id),
  quote_id BIGINT REFERENCES quotes(id),
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  seller_id BIGINT NOT NULL REFERENCES users(id),
  current_version_no INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'negotiating' CHECK (status IN ('negotiating','active','completed','terminated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 계약 버전: 양측이 동의한 조건 전문을 버전별로 보관(변경 계약 포함). 법률 검토 전에는 초안 표시.
CREATE TABLE contract_versions (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  version_no INT NOT NULL,
  terms JSONB NOT NULL,
  is_draft BOOLEAN NOT NULL DEFAULT true,
  legal_reviewed BOOLEAN NOT NULL DEFAULT false,
  buyer_agreed_at TIMESTAMPTZ,
  seller_agreed_at TIMESTAMPTZ,
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version_no)
);

-- 단계별 작업(마일스톤). 단계마다 별도 주문·결제를 만든다(분할 지급 아님).
CREATE TABLE milestones (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  seq INT NOT NULL,
  title TEXT NOT NULL,
  deliverables TEXT NOT NULL DEFAULT '',
  required_files JSONB NOT NULL DEFAULT '[]',  -- 최종 단계는 소스·실행 방법·필수 문서가 필수
  amount BIGINT NOT NULL CHECK (amount > 0),
  due_date DATE,
  inspection_days INT NOT NULL DEFAULT 7 CHECK (inspection_days BETWEEN 1 AND 60),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','awaiting_payment','in_progress','delivered','accepted','cancelled')),
  UNIQUE (contract_id, seq)
);

CREATE TABLE change_orders (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL REFERENCES contracts(id),
  requested_by BIGINT NOT NULL REFERENCES users(id),
  existing_scope TEXT NOT NULL,
  added_scope TEXT NOT NULL,
  in_original_scope BOOLEAN,                    -- 수정 요청의 계약 범위 분류(범위 내 수정인지 추가 개발인지)
  amount_delta BIGINT NOT NULL DEFAULT 0,
  days_delta INT NOT NULL DEFAULT 0,
  buyer_agreed_at TIMESTAMPTZ,
  seller_agreed_at TIMESTAMPTZ,
  resulting_version_id BIGINT REFERENCES contract_versions(id),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','agreed','rejected','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── 지식재산권 거래 ─────────────
CREATE TABLE ip_listings (
  id BIGSERIAL PRIMARY KEY,
  seller_id BIGINT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  public_intro TEXT NOT NULL DEFAULT '',
  right_type TEXT NOT NULL CHECK (right_type IN ('copyright_transfer','exclusive_license','nonexclusive_license','other_consult','business_asset_consult')),
  subject TEXT NOT NULL DEFAULT '',
  right_holder TEXT NOT NULL DEFAULT '',
  seller_authority TEXT NOT NULL DEFAULT '',   -- 판매 권한의 근거
  co_owners TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  is_exclusive BOOLEAN NOT NULL DEFAULT false,
  term TEXT NOT NULL DEFAULT '',
  territory TEXT NOT NULL DEFAULT '',
  field_of_use TEXT NOT NULL DEFAULT '',
  existing_licenses TEXT NOT NULL DEFAULT '',
  third_party TEXT NOT NULL DEFAULT '',
  included_assets TEXT NOT NULL DEFAULT '',
  excluded_assets TEXT NOT NULL DEFAULT '',
  asking_price BIGINT,
  locked_by_deal_id BIGINT,                    -- 독점 거래 진행 중 중복 판매 잠금
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','listed','locked','sold','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ip_deals (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES ip_listings(id),
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  contract_id BIGINT REFERENCES contracts(id),
  amount BIGINT,
  extra_verification BOOLEAN NOT NULL DEFAULT false, -- 고액·권리 양도 거래의 별도 확인 절차 선택
  stage TEXT NOT NULL DEFAULT 'consult' CHECK (stage IN ('consult','nda','data_room','due_diligence','terms','contract_payment','asset_transfer','rights_transfer_check','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 비공개 자료실 열람 승인(비밀유지 조건 동의 기록 포함)
CREATE TABLE ip_access_grants (
  id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES ip_listings(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  nda_text_sha256 TEXT NOT NULL,
  nda_agreed_at TIMESTAMPTZ NOT NULL,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (listing_id, user_id)
);

-- 자산 인도 목록. 계정·앱 등록 자산은 제공자의 공식 이전 절차 확인이 있어야 완료.
CREATE TABLE ip_transfer_items (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES ip_deals(id),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('source_repo','source_snapshot','build_docs','design_source','domain','service_asset','contract_docs','other')),
  description TEXT NOT NULL DEFAULT '',
  official_transfer_required BOOLEAN NOT NULL DEFAULT false,
  official_transfer_evidence TEXT NOT NULL DEFAULT '',
  seller_marked_at TIMESTAMPTZ,
  buyer_confirmed_at TIMESTAMPTZ,
  CHECK (NOT official_transfer_required OR buyer_confirmed_at IS NULL OR official_transfer_evidence <> '')
);

-- ───────────── 파일 버전·보관 ─────────────
-- 파일 버전은 상품, 마일스톤 납품, 지식재산권 자료실 중 정확히 하나에 속한다.
CREATE TABLE file_versions (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products(id),
  milestone_id BIGINT REFERENCES milestones(id),
  ip_listing_id BIGINT REFERENCES ip_listings(id),
  label TEXT NOT NULL,
  status version_status NOT NULL DEFAULT 'draft',
  created_by BIGINT NOT NULL REFERENCES users(id),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  CHECK ((product_id IS NOT NULL)::int + (milestone_id IS NOT NULL)::int + (ip_listing_id IS NOT NULL)::int = 1)
);
ALTER TABLE products ADD CONSTRAINT products_current_version_fk FOREIGN KEY (current_version_id) REFERENCES file_versions(id);

CREATE TABLE files (
  id BIGSERIAL PRIMARY KEY,
  version_id BIGINT NOT NULL REFERENCES file_versions(id),
  kind TEXT NOT NULL CHECK (kind IN ('executable','source','install_doc','deps','env_example','db_schema','license_notice','guide','evidence','other')),
  filename TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),   -- 빈 파일은 등록 자체가 불가
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'), -- 동일 파일 확인용. 기능·권한의 증명이 아님
  storage_key TEXT NOT NULL UNIQUE,            -- S3 호환 비공개 버킷의 객체 키
  key_wrapped TEXT NOT NULL,                   -- 파일별 암호화 키(마스터 키로 감쌈)
  scan_archive scan_status NOT NULL DEFAULT 'pending',  -- 압축 폭탄·경로 탈출
  scan_secret scan_status NOT NULL DEFAULT 'pending',   -- 비밀키·개인정보 패턴
  scan_malware scan_status NOT NULL DEFAULT 'pending',  -- 악성 파일
  scan_detail JSONB NOT NULL DEFAULT '[]',
  build_ok BOOLEAN,                            -- 격리 환경 빌드 성공 여부(기능 검수와 별개)
  uploaded_by BIGINT NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── 수수료 정책 ─────────────
CREATE TABLE fee_policies (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('default','category','seller')),
  scope_ref TEXT NOT NULL DEFAULT '',
  rate_bps INT NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),  -- 공급가액 기준 요율(1bp = 0.01%)
  pg_fee_bearer TEXT NOT NULL DEFAULT 'seller' CHECK (pg_fee_bearer IN ('seller','platform')),
  valid_from TIMESTAMPTZ,                      -- 할인 기간은 기간이 지정된 정책으로 표현
  valid_to TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── 주문과 7대 상태 ─────────────
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  order_type order_type NOT NULL,
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  seller_id BIGINT NOT NULL REFERENCES users(id),
  company_id BIGINT REFERENCES companies(id),
  product_id BIGINT REFERENCES products(id),
  option_id BIGINT REFERENCES product_options(id),
  milestone_id BIGINT UNIQUE REFERENCES milestones(id),
  ip_deal_id BIGINT REFERENCES ip_deals(id),
  version_id BIGINT REFERENCES file_versions(id),  -- 고정된 납품 버전(마일스톤은 납품 제출 시 1회 지정)
  snapshot JSONB NOT NULL,                     -- 주문 시점의 설명·제공 파일·권리·검수 기준·환불 절차
  terms_agreed_at TIMESTAMPTZ NOT NULL,        -- 구매자가 위 조건에 동의한 시각
  amount BIGINT NOT NULL CHECK (amount > 0),
  pay_method TEXT NOT NULL,
  fee_policy JSONB NOT NULL,                   -- 주문 시점 수수료 정책
  fee_bps INT NOT NULL,
  pg_fee_bps INT NOT NULL,
  pg_fee_bearer TEXT NOT NULL CHECK (pg_fee_bearer IN ('seller','platform')),
  seller_business_type business_type NOT NULL, -- 주문 시점 판매자 사업자 유형

  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  escrow_status escrow_status NOT NULL DEFAULT 'none',
  delivery_status delivery_status NOT NULL DEFAULT 'not_ready',
  inspection_status inspection_status NOT NULL DEFAULT 'not_started',
  dispute_status dispute_status NOT NULL DEFAULT 'none',
  refund_status refund_status NOT NULL DEFAULT 'none',
  payout_status payout_status NOT NULL DEFAULT 'not_eligible',

  delivery_detail TEXT NOT NULL DEFAULT '',
  delivery_due_at TIMESTAMPTZ,
  inspection_days INT NOT NULL,
  inspection_started_at TIMESTAMPTZ,
  inspection_due_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  refunded_amount BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  access_until TIMESTAMPTZ,                    -- 보관 정책에 따른 접근 기한(판매자 탈퇴와 무관)
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (refunded_amount <= amount),
  CHECK ((order_type = 'product' AND product_id IS NOT NULL AND version_id IS NOT NULL)
      OR (order_type = 'milestone' AND milestone_id IS NOT NULL)
      OR (order_type = 'ip' AND ip_deal_id IS NOT NULL)),
  -- 상태 조합의 불변식(전이 규칙은 src/domain/states.ts, 여기서는 절대 깨지면 안 되는 것만)
  CHECK (inspection_status = 'not_started' OR delivery_status IN ('granted','revoked')),     -- 납품 없이 검수 시작 금지
  CHECK (delivery_status NOT IN ('granted') OR payment_status IN ('paid','partially_refunded')), -- 결제 확인 없이 접근 허용 금지
  CHECK (NOT (payout_status = 'eligible' AND dispute_status = 'open')),                      -- 분쟁 중에는 지급 대상이 될 수 없음
  CHECK (payout_status NOT IN ('eligible') OR inspection_status IN ('confirmed','auto_confirmed','closed_by_admin')),
  CHECK (payment_status <> 'cancelled' OR payout_status IN ('not_eligible','void','blocked','failed'))
);
CREATE INDEX orders_buyer_idx ON orders(buyer_id);
CREATE INDEX orders_seller_idx ON orders(seller_id);
CREATE INDEX orders_product_idx ON orders(product_id);

CREATE TABLE purchase_approvals (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  company_id BIGINT NOT NULL REFERENCES companies(id),
  requested_by BIGINT NOT NULL REFERENCES users(id),
  decided_by BIGINT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL,
  external_status TEXT NOT NULL DEFAULT 'ready',   -- 외부 사업자가 알려준 상태 원문
  external_refunded BIGINT NOT NULL DEFAULT 0,
  external_checked_at TIMESTAMPTZ,                 -- 서버가 사업자에 직접 조회한 시각
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);

-- 대금 보호 기록: 외부 사업자에서 실제로 일어난 보호·보류·해제 이벤트만 적는다.
CREATE TABLE escrow_records (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')),
  event TEXT NOT NULL CHECK (event IN ('held','hold_requested','hold_confirmed','hold_unsupported','hold_failed','released','refunded')),
  external_ref TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature_ok BOOLEAN NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error TEXT,
  UNIQUE (provider, event_id)                  -- 중복 웹훅은 여기서 걸러진다
);

CREATE TABLE deliveries (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  version_id BIGINT REFERENCES file_versions(id),
  status delivery_status NOT NULL,
  missing JSONB NOT NULL DEFAULT '[]',         -- 누락·손상 파일 확인 결과
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE download_logs (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  file_id BIGINT NOT NULL REFERENCES files(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  ip TEXT NOT NULL DEFAULT '',
  link_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inspections (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  round INT NOT NULL DEFAULT 1,
  inspector_id BIGINT NOT NULL REFERENCES users(id),
  checklist JSONB NOT NULL,                    -- 7개 검수 항목별 결과
  result TEXT NOT NULL CHECK (result IN ('accepted','revision_requested','disputed')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, round)
);

CREATE TABLE close_requests (                  -- 판매자의 검수 종료 심사 요청
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  seller_id BIGINT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected')),
  decided_by BIGINT REFERENCES users(id),
  decision_basis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE disputes (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  opened_by BIGINT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('not_delivered','late','empty_or_wrong_file','source_missing','file_missing','feature_mismatch','env_failure','undisclosed_cost','rights_infringement','other')),
  description TEXT NOT NULL,
  wants_refund BOOLEAN NOT NULL DEFAULT false,
  post_settlement BOOLEAN NOT NULL DEFAULT false,  -- 이미 지급된 뒤 접수: 사후 환불·회수 검토로 연결
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  external_hold external_hold_status NOT NULL DEFAULT 'not_requested', -- 외부 지급 보류의 실제 결과
  external_hold_detail TEXT NOT NULL DEFAULT '',
  decision TEXT CHECK (decision IN ('refund_full','refund_partial','resume','release','external_resolution')),
  decision_amount BIGINT,
  decision_basis TEXT,
  decided_by BIGINT REFERENCES users(id),      -- 사람 운영자만 가능(AI 단독 판단 금지)
  decided_at TIMESTAMPTZ,
  appeal_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (decision IS NOT NULL AND decision_basis IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE dispute_entries (
  id BIGSERIAL PRIMARY KEY,
  dispute_id BIGINT NOT NULL REFERENCES disputes(id),
  author_id BIGINT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('buyer','seller','operator')),
  kind TEXT NOT NULL DEFAULT 'statement' CHECK (kind IN ('statement','evidence','fix_offer','settlement_offer','appeal')),
  body TEXT NOT NULL,
  file_id BIGINT REFERENCES files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  dispute_id BIGINT REFERENCES disputes(id),
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','processing','completed','failed','unsupported','rejected','post_settlement_review')),
  idempotency_key TEXT NOT NULL UNIQUE,
  basis TEXT NOT NULL DEFAULT '',
  failure TEXT NOT NULL DEFAULT '',
  approved_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_confirmed_at TIMESTAMPTZ,           -- 사업자의 결제 취소 성공을 확인한 시각
  completed_at TIMESTAMPTZ,
  CHECK (status <> 'completed' OR external_confirmed_at IS NOT NULL)  -- 취소 성공 확인 없이 완료 처리 금지
);

CREATE TABLE payouts (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id),   -- 주문당 지급 1건: 중복 지급 차단
  seller_id BIGINT NOT NULL REFERENCES users(id),
  attempt INT NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  seller_business_type business_type NOT NULL,
  base_amount BIGINT NOT NULL,                 -- 결제액 − 환불액
  fee_supply BIGINT NOT NULL,                  -- 플랫폼 수수료 공급가액
  fee_vat BIGINT NOT NULL,                     -- 수수료 부가세 10%
  pg_fee BIGINT NOT NULL,                      -- 결제 비용 전체
  seller_pg_fee BIGINT NOT NULL,               -- 그중 판매자 부담분
  withholding_income_tax BIGINT NOT NULL DEFAULT 0,  -- 개인: 소득세 3%
  withholding_local_tax BIGINT NOT NULL DEFAULT 0,   -- 개인: 지방소득세 0.3%
  net_amount BIGINT NOT NULL CHECK (net_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('requested','unknown','paid','failed')),
  provider_payout_id TEXT,
  failure TEXT NOT NULL DEFAULT '',
  requested_by BIGINT REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 지급 요청 접수
  external_confirmed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,                              -- 지급 완료 확인
  CHECK (base_amount = fee_supply + fee_vat + seller_pg_fee + withholding_income_tax + withholding_local_tax + net_amount),
  CHECK (status <> 'paid' OR external_confirmed_at IS NOT NULL)
);

-- 세무·증빙 기초 데이터(세금계산서 발행 대상, 지급명세서 기초 자료)
CREATE TABLE tax_records (
  id BIGSERIAL PRIMARY KEY,
  payout_id BIGINT NOT NULL REFERENCES payouts(id),
  seller_id BIGINT NOT NULL REFERENCES users(id),
  doc_type tax_doc_type NOT NULL,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),  -- 귀속 연월
  supply_amount BIGINT NOT NULL DEFAULT 0,
  vat_amount BIGINT NOT NULL DEFAULT 0,
  gross_payment BIGINT NOT NULL DEFAULT 0,     -- 원천징수 대상 지급액
  income_tax BIGINT NOT NULL DEFAULT 0,
  local_tax BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','reported','void')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payout_id, doc_type)
);

-- 거래 원장: 추가만 가능. ref 가 멱등성 키 역할을 한다.
CREATE TABLE ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id),
  kind ledger_kind NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  ref TEXT NOT NULL UNIQUE,
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_order_idx ON ledger_entries(order_id);

-- ───────────── 대사 ─────────────
CREATE TABLE recon_runs (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  checked INT NOT NULL DEFAULT 0,
  mismatched INT NOT NULL DEFAULT 0
);

CREATE TABLE recon_mismatches (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES recon_runs(id),
  order_id BIGINT REFERENCES orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('payment_status','payment_amount','refund_amount','payout_status','payout_amount','missing_internal','missing_external')),
  internal_value TEXT NOT NULL,
  external_value TEXT NOT NULL,
  resolved_by BIGINT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution TEXT
);

-- ───────────── 소통·후기·신고·지원 ─────────────
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id),
  product_id BIGINT REFERENCES products(id),   -- 구매 전 문의
  contract_id BIGINT REFERENCES contracts(id),
  sender_id BIGINT NOT NULL REFERENCES users(id),
  recipient_id BIGINT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id),  -- 실제 구매 1건당 후기 1건
  product_id BIGINT NOT NULL REFERENCES products(id),
  buyer_id BIGINT NOT NULL REFERENCES users(id),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  hidden_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wishlist (
  user_id BIGINT NOT NULL REFERENCES users(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE reports (                         -- 권리 침해·문제 상품 신고
  id BIGSERIAL PRIMARY KEY,
  reporter_id BIGINT NOT NULL REFERENCES users(id),
  product_id BIGINT REFERENCES products(id),
  ip_listing_id BIGINT REFERENCES ip_listings(id),
  reason TEXT NOT NULL CHECK (reason IN ('rights_infringement','malware','false_description','fake_review','other')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
  action_taken TEXT NOT NULL DEFAULT '',
  handled_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ
);

CREATE TABLE support_tickets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  order_id BIGINT REFERENCES orders(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  assigned_to BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 외부 AI로 비공개 자료를 보내기 전 받은 명시적 동의
CREATE TABLE ai_consents (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id),
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── 불변성 트리거 ─────────────
-- ① 심사 제출 이후의 파일 버전은 파일 추가·교체·삭제 불가(검사 결과 갱신만 허용)
CREATE FUNCTION files_guard() RETURNS trigger AS $$
DECLARE st version_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO st FROM file_versions WHERE id = NEW.version_id;
    IF st <> 'draft' THEN RAISE EXCEPTION 'FILE_VERSION_LOCKED'; END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT status INTO st FROM file_versions WHERE id = OLD.version_id;
    IF st <> 'draft' THEN RAISE EXCEPTION 'FILE_VERSION_LOCKED'; END IF;
    RETURN OLD;
  ELSE
    SELECT status INTO st FROM file_versions WHERE id = OLD.version_id;
    IF st <> 'draft' AND (NEW.sha256 <> OLD.sha256 OR NEW.storage_key <> OLD.storage_key OR NEW.filename <> OLD.filename
       OR NEW.size_bytes <> OLD.size_bytes OR NEW.kind <> OLD.kind OR NEW.version_id <> OLD.version_id
       OR NEW.key_wrapped <> OLD.key_wrapped) THEN
      RAISE EXCEPTION 'FILE_VERSION_LOCKED';
    END IF;
    RETURN NEW;
  END IF;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER files_guard_t BEFORE INSERT OR UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION files_guard();

-- ② 주문 시점에 확정한 조건은 변경 불가. 납품 버전은 한 번 정해지면 바꿀 수 없다.
CREATE FUNCTION orders_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.snapshot::text <> OLD.snapshot::text OR NEW.amount <> OLD.amount OR NEW.fee_bps <> OLD.fee_bps
     OR NEW.fee_policy::text <> OLD.fee_policy::text OR NEW.pg_fee_bps <> OLD.pg_fee_bps OR NEW.pg_fee_bearer <> OLD.pg_fee_bearer
     OR NEW.buyer_id <> OLD.buyer_id OR NEW.seller_id <> OLD.seller_id OR NEW.inspection_days <> OLD.inspection_days
     OR NEW.order_type <> OLD.order_type OR NEW.terms_agreed_at <> OLD.terms_agreed_at
     OR NEW.seller_business_type <> OLD.seller_business_type
     OR (OLD.version_id IS NOT NULL AND NEW.version_id IS DISTINCT FROM OLD.version_id) THEN
    RAISE EXCEPTION 'ORDER_TERMS_IMMUTABLE';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_guard_t BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_guard();

-- ③ 동의가 끝난 계약 버전은 변경 불가(변경은 새 버전으로)
CREATE FUNCTION contract_versions_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.buyer_agreed_at IS NOT NULL AND OLD.seller_agreed_at IS NOT NULL
     AND (NEW.terms::text <> OLD.terms::text OR NEW.version_no <> OLD.version_no OR NEW.contract_id <> OLD.contract_id) THEN
    RAISE EXCEPTION 'CONTRACT_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER contract_versions_guard_t BEFORE UPDATE ON contract_versions FOR EACH ROW EXECUTE FUNCTION contract_versions_guard();

-- ④ 원장·감사 로그·다운로드 기록·웹훅 원문은 추가만 가능
CREATE FUNCTION append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER download_append_only BEFORE UPDATE OR DELETE ON download_logs FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER escrow_append_only BEFORE UPDATE OR DELETE ON escrow_records FOR EACH ROW EXECUTE FUNCTION append_only();
