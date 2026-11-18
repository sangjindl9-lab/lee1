-- 출시 예정: 소개만 보이고 구매할 수 없는 상태. 납품 파일 등록과 심사를 거쳐야 판매 중이 된다.
ALTER TYPE product_status ADD VALUE IF NOT EXISTS 'coming_soon';
