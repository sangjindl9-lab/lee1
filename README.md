# 이음뷰어 — PDF · DWG · DXF 뷰어 (안드로이드)

휴대폰에서 PDF 와 캐드 도면(DWG·DXF)을 열어 보고, 치수를 재고, PDF 는 편집해서 저장하는 앱입니다.
인터넷 없이 동작합니다(파일이 서버로 올라가지 않습니다).

## 설치
저장소의 **Releases → "이음뷰어 앱 (최신)" → `eum-viewer.apk`** 를 휴대폰에서 내려받아 설치합니다.
`eum-viewer` 브랜치에 올리면 GitHub Actions 가 APK 를 자동으로 다시 만듭니다.

## 기능
- 홈: 파일 열기 · 최근 문서. 파일 관리자/카카오톡에서 pdf·dwg·dxf 를 눌러 "이음뷰어"로 바로 열기
- 공통: 한 손가락 이동, 두 손가락 확대·축소, 두 번 두드려 확대
- **DWG·DXF**: 레이어 켜고 끄기, 거리·면적 측정(끝점 자동 붙임), 단위(mm/cm/m/인치/피트) 선택
- **PDF 보기·편집**
  - 주석: 펜, 형광펜, 글 넣기, 도형(사각형·타원·직선·화살표), 이미지(도장·서명) 넣기
  - 글자 고치기: 기존 글자를 흰 상자로 덮고 새 글자를 씀
  - 양식(폼) 입력: 글 칸, 체크박스, 선택 목록
  - 쪽 관리: 회전·삭제·순서 바꾸기, 다른 PDF 끼워넣기(합치기), 일부 쪽만 저장(나누기)
  - 측정: 축척 1:N 입력 또는 길이를 아는 두 점으로 보정 → 거리·면적
  - 저장(덮어쓰기) · 다른 이름으로 저장 · 공유

## 구성
| 위치 | 내용 |
|---|---|
| `app/src/` | 화면 코드 — `main.js`(홈·전환), `pdfview.js`(PDF 보기·편집), `pdfsave.js`(PDF 저장), `cadview.js`(DWG·DXF), `measure.js`(측정), `stage.js`(이동·확대), `files.js`(파일), `ui.js` |
| `app/www/` | `index.html`, `style.css`, 한글 글꼴(`NotoSansKR-sub.ttf`, KS X 1001 한글만 남긴 Noto Sans KR). `npm run build` 가 `app.js`·`pdf.worker.js`·`libredwg-web.wasm`·`cmaps/` 를 여기에 만든다 |
| `app/android/` | 안드로이드 앱(Capacitor). `EumFilesPlugin.java` 가 파일 열기·저장·공유 담당 |
| `app/test/` | 브라우저 자동 점검(`test/README.md`) |

## 쓰는 오픈소스
- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) — PDF 그리기
- [pdf-lib](https://pdf-lib.js.org/) (MIT) — PDF 편집·저장
- [libredwg-web](https://github.com/mlightcad/libredwg-web) (GPL-3.0, LibreDWG 기반) — DWG 읽기·SVG 변환
- [@mlightcad/dxf-json](https://github.com/mlightcad/dxf-json) (GPL-3.0) — DXF 읽기
- Noto Sans KR (OFL) — 한글 글꼴

> 이 앱의 소스는 **GPL-3.0** 으로 공개합니다(`LICENSE`). DWG·DXF 읽기 라이브러리(libredwg)가 GPL-3.0 이기 때문입니다. 개인정보처리방침은 `PRIVACY.md`.
