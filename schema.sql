-- 스테이온 숙소예약 스키마 (서버 시작 시 자동 적용, 여러 번 실행해도 안전)

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text UNIQUE,
  password_hash text,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user',            -- user | admin
  status text NOT NULL DEFAULT 'active',        -- active | blocked | withdrawn
  profile_done boolean NOT NULL DEFAULT false,  -- 휴대폰·약관 입력 완료 여부
  marketing boolean NOT NULL DEFAULT false,
  terms_at timestamptz,
  memo text NOT NULL DEFAULT '',
  token_ver int NOT NULL DEFAULT 1,             -- 올리면 기존 로그인 무효
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS user_identities (
  provider text NOT NULL,                       -- google | kakao
  provider_uid text NOT NULL,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_uid)
);

CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY,
  mime text NOT NULL,
  data bytea NOT NULL,
  size int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS places (
  id serial PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  grade text NOT NULL DEFAULT '',
  sido text NOT NULL,
  area text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  check_in text NOT NULL DEFAULT '15:00',
  check_out text NOT NULL DEFAULT '11:00',
  intro text NOT NULL DEFAULT '',
  notice text NOT NULL DEFAULT '',
  amenities text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  photos text[] NOT NULL DEFAULT '{}',
  featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id serial PRIMARY KEY,
  place_id int NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name text NOT NULL,
  base int NOT NULL DEFAULT 2,
  max int NOT NULL DEFAULT 2,
  stock int NOT NULL DEFAULT 1,
  price int NOT NULL DEFAULT 0,
  weekend_price int NOT NULL DEFAULT 0,
  list_price int NOT NULL DEFAULT 0,
  descr text NOT NULL DEFAULT '',
  photos text[] NOT NULL DEFAULT '{}',
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

-- 날짜별 재고·요금 (예약 시 행 잠금으로 초과 예약 방지)
CREATE TABLE IF NOT EXISTS room_nights (
  room_id int NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  night date NOT NULL,
  booked int NOT NULL DEFAULT 0,
  closed boolean NOT NULL DEFAULT false,
  price int,
  PRIMARY KEY (room_id, night)
);

CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  user_id int REFERENCES users(id) ON DELETE SET NULL,
  place_id int,
  room_id int,
  place_name text NOT NULL,
  room_name text NOT NULL,
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights int NOT NULL,
  adults int NOT NULL,
  children int NOT NULL DEFAULT 0,
  guest_name text NOT NULL,
  phone text NOT NULL,
  visit text NOT NULL DEFAULT '도보',
  request text NOT NULL DEFAULT '',
  lines jsonb NOT NULL DEFAULT '[]',            -- 1박별 요금
  total int NOT NULL,                           -- 객실 요금 합계
  points_used int NOT NULL DEFAULT 0,
  amount_due int NOT NULL,                      -- 실제 결제 금액
  pay_method text NOT NULL,                     -- card | bank | site | points
  status text NOT NULL,                         -- pending | wait | ok | done | cancel
  hold_until timestamptz,
  points_earned int NOT NULL DEFAULT 0,
  refund_amount int NOT NULL DEFAULT 0,
  refund_points int NOT NULL DEFAULT 0,
  cancel_reason text NOT NULL DEFAULT '',
  cancelled_by text NOT NULL DEFAULT '',
  admin_memo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status);
CREATE INDEX IF NOT EXISTS bookings_checkin_idx ON bookings(check_in);

CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  booking_id int NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id int,
  order_id text UNIQUE NOT NULL,
  provider text NOT NULL,                       -- mock | toss | bank | site
  method text NOT NULL,
  amount int NOT NULL,
  status text NOT NULL,                         -- ready | paid | failed | cancelled | partial_cancelled
  payment_key text,
  cancelled_amount int NOT NULL DEFAULT 0,
  receipt_url text NOT NULL DEFAULT '',
  raw jsonb,
  fail_reason text NOT NULL DEFAULT '',
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 포인트 원장: 잔액 = sum(amount). 적립 행은 remaining 으로 선입선출 차감·소멸
CREATE TABLE IF NOT EXISTS point_tx (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount int NOT NULL,
  kind text NOT NULL,      -- signup | earn | use | use_cancel | earn_cancel | admin_add | admin_sub | expire
  remaining int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  booking_id int,
  memo text NOT NULL DEFAULT '',
  detail jsonb,
  admin_id int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_tx_user_idx ON point_tx(user_id);

CREATE TABLE IF NOT EXISTS reviews (
  id serial PRIMARY KEY,
  booking_id int UNIQUE REFERENCES bookings(id) ON DELETE SET NULL,
  user_id int REFERENCES users(id) ON DELETE SET NULL,
  place_id int NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  room_name text NOT NULL DEFAULT '',
  author text NOT NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text NOT NULL,
  reply text NOT NULL DEFAULT '',
  reply_at timestamptz,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wishes (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id int NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS banners (
  id serial PRIMARY KEY,
  title text NOT NULL,
  sub text NOT NULL DEFAULT '',
  advertiser text NOT NULL DEFAULT '',
  contact text NOT NULL DEFAULT '',
  slot text NOT NULL,                           -- home | list | detail
  image text,
  link text NOT NULL DEFAULT '',
  bg text NOT NULL DEFAULT '#3b4bdf',
  start_date date NOT NULL,
  end_date date NOT NULL,
  fee int NOT NULL DEFAULT 0,
  priority int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_stats (
  banner_id int NOT NULL REFERENCES banners(id) ON DELETE CASCADE,
  day date NOT NULL,
  imp int NOT NULL DEFAULT 0,
  clk int NOT NULL DEFAULT 0,
  PRIMARY KEY (banner_id, day)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id serial PRIMARY KEY,
  admin_id int,
  action text NOT NULL,
  target text NOT NULL DEFAULT '',
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
