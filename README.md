# SS-ERP 소개 사이트 + 도입 문의

- `public/page.html` — 소개 페이지 본문 (클로드 아티팩트와 같은 내용)
- `POST /api/inquiry` — 문의 접수: `DATA_DIR/inquiries.jsonl` 에 저장하고 SMTP 가 설정돼 있으면 `INQUIRY_TO` 로 메일 발송
- `GET /admin/inquiries?token=ADMIN_TOKEN` — 접수된 문의 목록

환경변수: `INQUIRY_TO`(받는 메일), `SMTP_USER`·`SMTP_PASS`(Gmail 앱 비밀번호), `SMTP_HOST`(기본 smtp.gmail.com), `SMTP_PORT`(기본 465), `ADMIN_TOKEN`, `DATA_DIR`(기본 ./data)
