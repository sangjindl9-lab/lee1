# SS 전자서명·도장 메이커 (React + Vite)

도뉴(donue.co.kr) 서명 페이지를 벤치마킹한 무료 전자서명·도장 생성기.

## 실행
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 생성 (정적 배포용)
```

## 배포
- Render: Static Site, Build `npm run build`, Publish directory `dist`
- Railway / Netlify / Vercel: 동일 (빌드 명령 `npm run build`, 출력 `dist`)

## 구조
- `src/lib/stamp.js` — 도장 캔버스 렌더러 (법인직인·개인인감·사각인감) + 여백 자르기
- `src/components/StampTab.jsx` — 도뉴식 도장 탭 (종류 / 문구 입력 14자 / 만들기 → 8종 미리보기 → 선택 → 만들기)
- `src/components/DrawTab.jsx` — 직접 그리기 서명
- `src/components/TypeTab.jsx` — 이름 입력 손글씨 서명
- `src/components/Result.jsx` — 결과 PNG 다운로드 / 복사
