# 이음 견적발주

발주자(우리 회사) 여러 곳 등록, 도장 이미지 업로드, 거래처 등록, 발주서 작성·보관, A4 PDF 저장을 하는 웹 + 안드로이드 앱입니다.

- 웹: https://balju.ieumerp.kr
- 개인정보처리방침: `/privacy` · 계정 삭제 안내: `/delete-account`

## 구성

| 경로 | 내용 |
| --- | --- |
| `server.js` | Express + PostgreSQL. 회원가입·로그인(쿠키 세션), 자료 저장 API, 계정 삭제. 시작할 때 같은 Postgres 서버에 `balju` 데이터베이스를 만들어 다른 앱과 분리 |
| `public/index.html` | 화면 전체(발주서 작성·발주자·거래처·보관함·내 계정). PDF는 브라우저에서 html2canvas + jsPDF로 생성 |
| `android/` | WebView 앱 `kr.eumsoft.balju`. 도장 이미지 선택, `window.BaljuApp.savePdf()`로 PDF를 다운로드/이음견적발주 폴더에 저장하고 공유 |
| `android/Dockerfile` | Railway에서 서명된 AAB·APK를 빌드해 내려받게 하는 빌더 |
| `scripts/gen-icons.py` | `public/icon.svg`로 웹·런처·스토어 아이콘 생성 |

## 실행

```bash
npm install
DATABASE_URL=postgres://user@localhost:5432/postgres npm start   # http://localhost:3300
```

## Railway (eum-apps 프로젝트)

- `eum-balju`: 이 브랜치 루트, `node server.js`, 변수 `DATABASE_URL=${{Postgres-rlyR.DATABASE_URL}}`, `PORT=8080`
- `eum-balju-aab-builder`: 루트 `/android`, Dockerfile 빌드. 변수 `APP_URL`, `KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `DL_TOKEN`
  빌드가 끝나면 `https://<빌더 도메인>/<DL_TOKEN>/eum-balju-release.aab` 와 `.apk` 를 내려받을 수 있습니다.
  새 버전을 올릴 때는 `android/app/build.gradle.kts` 의 `versionCode` 를 1씩 올리고 푸시합니다.
