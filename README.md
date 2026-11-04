# 이음전력 진단 — 전체 소스 설치·실행 방법

## 구성

```
ieum-power-diagnosis/
├── ieum-power-standalone/   ← 바로 실행 가능 (HTML 단독, Render 정적 배포용)
│   ├── index.html
│   ├── render.yaml
│   └── README.md
├── ieum-power/              ← Next.js 풀스택 (확장 개발용)
│   ├── src/
│   │   ├── app/             (페이지)
│   │   └── lib/
│   │       ├── calculation-engine.ts  (독립 계산 엔진)
│   │       └── store.ts
│   ├── package.json
│   └── ...
└── 이음전력진단-설치안내.md  (이 파일)
```

---

## 1. 정적 버전 (가장 빠름) — 추천

### 로컬에서 바로 보기
1. `ieum-power-standalone` 폴더로 이동
2. `index.html`을 브라우저로 연다 (더블클릭)
3. 또는 터미널:
   ```bash
   cd ieum-power-standalone
   python3 -m http.server 8080
   ```
   브라우저에서 http://localhost:8080

### Render 배포
1. https://render.com 가입
2. New → Static Site
3. GitHub에 `ieum-power-standalone` 내용 올린 뒤 저장소 연결
4. Build Command: (비움)
5. Publish Directory: `.`
6. Create → 생성된 URL로 접속

---

## 2. Next.js 버전 (확장·개발용)

### 필요 환경
- Node.js 18 이상 (20 LTS 권장)
- npm 또는 yarn

### 설치
```bash
cd ieum-power
npm install
```

### 실행 (개발)
```bash
npm run dev
```
브라우저에서 http://localhost:3000

### 빌드·프로덕션
```bash
npm run build
npm start
```

### 주요 경로
| 경로 | 설명 |
|------|------|
| `/` | 소개 |
| `/quick` | 무료 간편 계산 (핵심) |
| `/places` | 장소 등록 (브라우저 저장) |
| `/login` | 데모 로그인 |
| `/admin` | 서비스명·로고 설정 |

### 데모 계정
- user@ieum.power / user1234
- pro@ieum.power / pro1234
- admin@ieum.power / admin1234

---

## 3. Render에 Next.js 올리기 (Web Service)

1. New → Web Service
2. GitHub 저장소 연결 (`ieum-power` 폴더 기준)
3. 설정:
   - Runtime: Node
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Instance: Free
4. 환경변수 (선택): 없음 (현재 클라이언트 저장 위주)

---

## 4. 핵심 원칙 요약

- 계약전력 / 예상 사용전력 / 설비 수용능력 **구분**
- 결과 상태 6가지 고정 문구만 사용
- 한전 직접 계약 vs 건물 관리 경로 분기
- 한전 납부금 = 예시 + 「한전 확인 필요」
- 계산 엔진은 AI와 분리 (순수 TypeScript/JS)
- “안전 인증”, “검사 합격” 표현 미사용

## 5. 제한 사항

- OCR·사진 자동 분석: 구조만 있음 (외부 API 연동 필요)
- 한전 실시간 API: 없음
- 공사 단가: 관리자 등록 구조, 현재 예시만
- 정적 버전은 서버 저장 없음 (브라우저 메모리)

문의·수정 요청은 개발자에게 전달하세요.
