-- 머묾 DB 스키마 (서버 시작 시 자동 적용, 여러 번 실행해도 안전)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,
  provider_id   text NOT NULL,
  email         text,
  name          text NOT NULL,
  avatar_url    text,
  phone         text,
  bio           text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'guest' CHECK (role IN ('guest','host','admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','withdrawn')),
  host_agreed_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,               -- 세션 토큰의 SHA-256 (원본 토큰은 저장하지 않음)
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  csrf       text NOT NULL,
  expires_at timestamptz NOT NULL,
  ip         text,
  ua         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_exp_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS listings (
  id            bigserial PRIMARY KEY,
  host_id       uuid NOT NULL REFERENCES users,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  category      text NOT NULL,
  region        text NOT NULL,
  area          text NOT NULL DEFAULT '',     -- 공개되는 동네 단위 주소
  address       text NOT NULL DEFAULT '',     -- 상세 주소: 예약 확정 후 게스트에게만 공개
  lat           double precision,
  lng           double precision,
  price         integer NOT NULL CHECK (price BETWEEN 10000 AND 10000000),
  cleaning_fee  integer NOT NULL DEFAULT 0 CHECK (cleaning_fee BETWEEN 0 AND 1000000),
  max_guests    integer NOT NULL CHECK (max_guests BETWEEN 1 AND 30),
  bedrooms      integer NOT NULL DEFAULT 1 CHECK (bedrooms BETWEEN 0 AND 30),
  beds          integer NOT NULL DEFAULT 1 CHECK (beds BETWEEN 0 AND 50),
  baths         integer NOT NULL DEFAULT 1 CHECK (baths BETWEEN 0 AND 30),
  amenities     text[] NOT NULL DEFAULT '{}',
  rules         text NOT NULL DEFAULT '',
  checkin_time  text NOT NULL DEFAULT '15:00',
  checkout_time text NOT NULL DEFAULT '11:00',
  min_nights    integer NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 30),
  instant_book  boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','suspended')),
  reject_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_search_idx ON listings(status, region, category);
CREATE INDEX IF NOT EXISTS listings_host_idx ON listings(host_id);

CREATE TABLE IF NOT EXISTS listing_photos (
  id         bigserial PRIMARY KEY,
  listing_id bigint NOT NULL REFERENCES listings ON DELETE CASCADE,
  sort       integer NOT NULL DEFAULT 0,
  data       bytea NOT NULL,                  -- 재인코딩된 WebP (EXIF·GPS 제거됨)
  thumb      bytea NOT NULL,
  width      integer, height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_listing_idx ON listing_photos(listing_id, sort);

CREATE TABLE IF NOT EXISTS blocked_dates (
  listing_id bigint NOT NULL REFERENCES listings ON DELETE CASCADE,
  day        date NOT NULL,
  PRIMARY KEY (listing_id, day)
);

CREATE TABLE IF NOT EXISTS bookings (
  id             bigserial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  listing_id     bigint NOT NULL REFERENCES listings,
  guest_id       uuid NOT NULL REFERENCES users,
  check_in       date NOT NULL,
  check_out      date NOT NULL,
  guests         integer NOT NULL CHECK (guests BETWEEN 1 AND 30),
  nightly        integer NOT NULL,
  nights         integer NOT NULL,
  cleaning_fee   integer NOT NULL,
  service_fee    integer NOT NULL,
  total          integer NOT NULL,
  host_fee       integer NOT NULL,
  host_payout    integer NOT NULL,
  status         text NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','confirmed','declined','cancelled','expired','completed')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded','not_required')),
  message        text NOT NULL DEFAULT '',
  decline_reason text,
  cancelled_by   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  cancelled_at   timestamptz,
  CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS bookings_guest_idx ON bookings(guest_id);
CREATE INDEX IF NOT EXISTS bookings_listing_idx ON bookings(listing_id, status);

-- 같은 숙소의 진행 중 예약끼리 날짜가 겹치지 않도록 DB가 직접 막는다 (동시 요청에도 이중 예약 불가)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (listing_id WITH =, daterange(check_in, check_out, '[)') WITH &&)
      WHERE (status IN ('requested','confirmed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS reviews (
  id          bigserial PRIMARY KEY,
  booking_id  bigint NOT NULL UNIQUE REFERENCES bookings,
  listing_id  bigint NOT NULL REFERENCES listings ON DELETE CASCADE,
  guest_id    uuid NOT NULL REFERENCES users,
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  cleanliness integer NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  accuracy    integer NOT NULL CHECK (accuracy BETWEEN 1 AND 5),
  location    integer NOT NULL CHECK (location BETWEEN 1 AND 5),
  body        text NOT NULL,
  host_reply  text,
  hidden      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_listing_idx ON reviews(listing_id);

CREATE TABLE IF NOT EXISTS wishlists (
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  listing_id bigint NOT NULL REFERENCES listings ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         bigserial PRIMARY KEY,
  booking_id bigint NOT NULL REFERENCES bookings ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES users,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_booking_idx ON messages(booking_id, id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  target     text,
  meta       jsonb NOT NULL DEFAULT '{}',
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at DESC);
