# 웹적산

㈜에스에스전력 웹 적산 프로그램 — 자재·노임단가 → 일위대가(2026 전기·통신 표준시장단가 포함) → 설계내역서 → 원가계산서 → 견적서, 엑셀 저장과 인쇄(PDF) 출력.

- 개발: `npm install && npm run dev`
- 배포(Railway): `npm run build` 후 `npm start` (PORT 환경변수 사용, `/health` 상태 확인)
- 데이터는 브라우저(localStorage)에 저장됩니다. 다른 PC로 옮길 때는 ‘프로젝트 → 공사 파일 백업(.json)’과 ‘파일 불러오기’를 쓰세요.
