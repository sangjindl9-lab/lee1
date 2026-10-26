# 관급자재 구매요청서 자동작성 (웹)

나라장터 쇼핑몰에서 관급자재(케이블트레이, 조명기구, 분전반 등 무엇이든)를 검색해서
업체·물품식별번호·단가·본사소재지·인증·외형도(제품사진)를 **원본 엑셀 양식 그대로** 채워 주는 웹 프로그램.

- `server.js` — 화면 제공 + 나라장터 쇼핑몰 검색/제품사진 중계 (`/api/search`, `/api/img`)
- `public/engine.js` — 원본 엑셀 XML을 직접 편집(값 셀·그림만 교체, 서식 보존)
- `public/card.js` — 외형도 캡처 이미지 생성
- `public/gwangeup_template.xlsx` — 내장 양식 (원본 구매요청서 엑셀의 출력 시트 4개를 서식 그대로 복사, 품목 20개까지)
- `public/app.js` — 화면 동작 (엑셀 업로드 없이 검색 결과로 바로 출력)
- `tools/build_template.py` — 원본 엑셀에서 내장 양식을 다시 만드는 스크립트 (`python3 tools/build_template.py 원본.xlsx public/gwangeup_template.xlsx`)

실행: `npm start` (Node 18 이상)
