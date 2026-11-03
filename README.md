# 이음전력 진단

가정·가게·사무실의 기기·계약전력·분전반 사진으로 **계약전력 / 예상 사용전력 / 설비 수용능력**을 구분해 검토하고, 증설 필요성·설비 개선 범위·예상 비용 보고서를 만드는 웹서비스 + 안드로이드 앱.

- 운영 주소: https://jindan-production.up.railway.app
- 안드로이드 앱: https://github.com/sangjindl9-lab/lee1/releases/download/jindan-latest/ieum-jindan.apk
- 소스: `lee1` 저장소 `jeonryeok-jindan` 브랜치 (푸시하면 Railway 재배포 + APK 자동 빌드)

## 구성

| 경로 | 내용 |
|---|---|
| `server/engine/units.js` | 단위 해석: W/kW·kW/kWh·AF/AT·A/mA/kA 구분, 명판 항목(소비전력·냉방능력·모터출력) 분류 |
| `server/engine/load.js` | 부하 계산 엔진: 5개 시나리오, 단상/삼상 전류, 상별 부하, 주차단기·분기회로·전선·전압강하, 기동전류, 계약전력 검토, 판정, 대안 |
| `server/engine/cost.js` | 한전 납부금(등록 요율만), 공사비(수량×단가 범위), 전기요금 비교, 고지서 계절 비교 |
| `server/ai.js` | 사진·고지서 추출(Anthropic, 보조 기능) + 규칙 기반 재검증 |
| `server/compute.js` | 장소 데이터 → 엔진 실행 → 결과·보고서 스냅샷 |
| `server/report.js` | 한국어 PDF·Excel (저장된 스냅샷으로만 생성 → 이전 보고서 재현) |
| `server/index.js` | API·인증·권한·업로드·감사기록·관리자 |
| `public/` | 화면(프레임워크 없음, 모바일 촬영 우선) |
| `app/` | 안드로이드 앱(Capacitor) — 운영 서버를 앱 화면으로 띄움, 카메라 촬영·PDF/Excel 내려받기 |
| `test/` | 계산 엔진·API 테스트 |

AI는 글자와 위치만 추출하고, 모든 수치와 판정은 계산 엔진이 냅니다. 사용자가 "확인/수정"한 추출값만 계산에 들어갑니다.

## 데이터베이스(SQLite, `DATA_DIR/jindan.db`)

`users`(역할: user/contractor/reviewer/admin), `companies`(업체·로고·견적 유효기간·이용권), `sessions`,
`sites`(장소·계약정보 info JSON·계산 가정·AI 전송 동의), `site_shares`(고객 동의 업체 공유·철회),
`files`(비공개 저장 파일), `bills`, `devices`, `panels`(QR 토큰), `circuits`(차단기·전선), `measurements`,
`extractions`(AI 원본·필드별 원본값/수정값/확인자/신뢰도/위치), `reviews`, `quotes`(공사 항목·한전 신청 조건·요금 조건),
`reports`(당시 입력·결과·규칙 버전 스냅샷), `share_links`(만료), `consults`, `records`(공사 전후 사진·실제 비용),
`rates_kepco`, `rates_tariff`, `unit_prices`, `standards`(허용전류표·판정 기준값), `device_refs`, `audit`(모든 변경 이력), `settings`.

## 환경변수

```
PORT=8080
DATA_DIR=/data                     # DB와 사진 저장 위치(Railway 볼륨)
ADMIN_EMAIL=관리자@이메일            # 최초 실행 시 관리자 계정 생성
ADMIN_PASSWORD=초기비밀번호
PUBLIC_URL=https://jindan-production.up.railway.app   # QR 주소
ANTHROPIC_API_KEY=                 # 넣으면 사진 분석 동작, 없으면 "미설정" 표시 후 수동 입력
AI_MODEL=claude-sonnet-5-5         # 선택
```

## 설치·실행

```
npm install
ADMIN_EMAIL=a@b.kr ADMIN_PASSWORD=12345678 npm start     # http://localhost:8080
npm test
```
Docker: `docker build -t jindan . && docker run -p 8080:8080 -v jindan:/data -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... jindan`

## 배포(Railway)

프로젝트 `ieum-jindan` / 서비스 `jindan` / 볼륨 `/data`. 브랜치 `jeonryeok-jindan`에 푸시하면 자동 배포.
**백업:** 관리자 → 서비스 설정 → "DB 백업 내려받기"(일관된 DB 사본). 사진은 볼륨의 `/data/files`에 있으니 Railway 볼륨 백업도 함께 켜 두세요.

## 안드로이드 앱

`app/` 수정 후 푸시하면 GitHub Actions가 APK를 만들어 릴리스 `jindan-latest`에 올립니다.
설치: 휴대폰에서 APK 링크 → 내려받기 → "출처를 알 수 없는 앱 설치" 허용. 웹 화면(안드로이드 브라우저)의 "앱 받기" 메뉴로도 받을 수 있습니다.
서버 주소를 바꾸면 `app/capacitor.config.json`의 `server.url`도 바꾸세요.

## 관리자 사용법

1. **서비스 설정**: 서비스명·로고·운영업체 정보·부가세율·이용권 안내 문구.
2. **한전 요율**: 공식 약관·단가표의 항목만 출처 URL·근거 문서·적용 시작/종료일·과세·조건·검토자·버전과 함께 등록. 신청 예정일에 유효한 요율이 없으면 결과는 "한전 확인 필요"(0원 처리 안 함).
3. **요금 규칙**: 계약종별(장소 정보와 같은 표기)별 기본요금·전력량요금. 없으면 요금 비교 보류.
4. **공사 단가**: 항목 코드·재료비·노무비·경비·지역·기준일·출처·종료일. 업체는 업체 화면에서 자사 단가 등록.
5. **적용 기준**: 허용전류표(도체·전선 종류·굵기·포설·온도·집합 → 허용전류), 전압강하 한도, 설비 불평형률 한도. 조건이 정확히 일치할 때만 판정.
6. **기기 참고값**: 출처가 있는 대표 소비전력만(명판·실측값 우선).
7. **사용자·이용권**: 역할 변경, 업체 지정, 상세 보고서 이용권 기간 부여.
8. **변경 이력**: 분석·수정·견적·요율 변경 기록.

## 테스트 결과 (`npm test`, 18개 통과)

W/kW·kW/kWh 혼동 방지 · AF/AT 오인식 · 정격전류/감도전류/차단용량 구분 · 냉방능력을 소비전력으로 쓰지 않음 · 모터 출력은 효율 명시 시에만 ·
전체 여유 있지만 분기회로 부족 · 계약전력만 부족 / 회로만 부족 · 분기차단기 합계를 주차단기로 쓰지 않음 · 삼상 단상부하 편중 · 상 배치 미확인 시 보류 ·
정상 운전/기동 구분 · 운전계수 1회 적용 · 짧은 측정기간 표시 · 아파트·재판매 사용자 경로 · 허용전류 기준 미등록 보류 · 한전 요율 미등록·만료 ·
공사 단가 미등록·만료 · 요금 회수기간 · 결과 수정 후 재계산과 이전 보고서 재현 · 다른 고객의 장소·사진·보고서 접근 차단 · 업체는 고객 동의 후에만 접근 · 업로드 형식 검증 · AI 미설정 시 수동 진행.

## 실제 연동 범위와 남은 제한

- **사진 분석**: Anthropic API 키를 넣어야 동작(현재 미설정). 미설정·미동의 시 사진은 저장되고 수동 입력으로 진행.
- **한전**: API 연동 없음. 고지서 업로드·수동 입력으로 운영. 한전 요율·요금 규칙·계약전력 결정 규칙은 **데이터가 비어 있음** — 관리자가 공식 자료로 등록해야 금액이 나옵니다. 약관상 계약전력 결정 규칙은 엔진에 넣지 않았고 "기술적 검토값"까지만 제시합니다.
- **허용전류·전압강하·불평형 기준**: 기준표 데이터 미등록 상태(판정 보류로 표시). KEC 등 확인된 기준표를 관리자가 입력해야 합니다.
- **결제**: 미연동. 상세 보고서·Excel 이용권은 관리자가 기간을 부여.
- **계측기 연동**: 없음(실측값 수동 입력). 실시간 모니터링 기능 없음.
- **파일**: JPG·PNG·WEBP·PDF, 15MB 이하. 아이폰 HEIC는 받지 않음(호환성 우선 촬영 안내).
- 안드로이드 APK는 디버그 서명입니다. Play 스토어에 올리려면 릴리스 서명 키가 필요합니다.
