# 시스템 아키텍처 — EUM 3D STUDIO PRO

## 1. 구성도
```
 브라우저 (React · TS · Three.js · R3F · Zustand · Tailwind)
   ├─ 작업 화면 /app/p/:id   (업로드·부품트리·3D 뷰어·분해·타임라인·영상·공유)
   ├─ 공유 쇼룸  /s/:token   (로그인 없음, 모바일 터치)
   └─ 렌더 페이지 /render     (헤드리스 브라우저 전용, 프레임 단위 출력)
        │  HTTPS (세션 쿠키 JWT)
 ┌──────▼──────────────── Node 22 (Express 5) ──────────────────────────┐
 │ API: 인증·프로젝트·분할업로드·파일·모델·장면·렌더·공유·감사로그      │
 │ 작업 큐 워커 (같은 프로세스 또는 별도 인스턴스, RUN_WORKER)            │
 │   ├ convert 레인 → worker_thread: OCCT(WASM) STEP/IGES, STL, GLB, DXF │
 │   └ render 레인  → Playwright Chromium(/render) → JPEG 파이프 → FFmpeg │
 └──────┬──────────────────────────────┬───────────────────────────────┘
   PostgreSQL (RLS 회사 격리, 작업 큐)   객체 저장소 /data/storage/companies/<회사ID>/…
```

## 2. 기술 선택과 지시서 대비 차이
| 영역 | 지시서 권장 | 구현 | 이유 |
| --- | --- | --- | --- |
| 프런트 | React/TS/Three/R3F/Tailwind/Zustand | 동일 | — |
| 백엔드 | Python FastAPI | **Node 22 + Express 5** | CAD 커널(Open CASCADE WASM, occt-import-js)과 렌더 워커(Playwright)·3D 계산(three)을 한 런타임에서 실행. 서버·브라우저·렌더가 **같은 분해/타임라인 코드(shared/scene.js)** 를 공유해 화면과 MP4 결과가 일치 |
| DB | PostgreSQL | PostgreSQL 14+ (RLS) | — |
| 큐 | Redis + 비동기 큐 | **PostgreSQL 큐 (FOR UPDATE SKIP LOCKED)** | 온프레미스 구성요소 최소화. 여러 워커 동시 실행 안전. 처리량이 커지면 Redis/BullMQ 로 교체 가능 |
| 저장소 | S3 호환 | **로컬 디스크/볼륨** (키 규칙은 S3 와 동일) | S3 드라이버는 4단계 (미구현) |
| CAD 엔진 | Open CASCADE, FreeCAD 워커 | **Open CASCADE 7.x (occt-import-js, LGPL-2.1)** | 네이티브 설치 없이 재배포 가능. FreeCAD 워커는 미구현 |
| 렌더 | Blender, FFmpeg | **헤드리스 Chromium(WebGL) + FFmpeg(libx264)** | 뷰어와 동일한 화면. Blender 고품질 렌더 워커는 추후 |

## 3. 파일 변환 파이프라인
1. 분할 업로드: `POST /projects/:id/uploads` → 8MB 조각 순차 `PUT …/chunks/:n` (행 잠금으로 중복 방지) → `complete`
2. 검사: 확장자 허용목록 + 내용 서명(STEP `ISO-10303-21`, GLB `glTF`, DXF `SECTION`, STL 구조) → 위장 파일 거부
3. 원본 보존: `companies/<cid>/originals/<fileId>/v<n>.<ext>`, sha256 기록, 같은 이름은 버전 증가(덮어쓰기 없음)
4. 변환 작업 큐 등록 → 워커 스레드
   - **STEP/IGES**: OCCT 로 B-Rep 읽기 → 테셀레이션 → 조립 계층·부품명(UTF-8 복원)·색상 유지 → GLB. AI 재생성 없음
   - **STL**: 바이너리/ASCII 파싱 → 단일 부품 GLB (단위 mm 가정 경고)
   - **GLB**: 형상 유지, 메시 노드마다 partId 부여
   - **DXF**: 단위·레이어·객체수·치수(측정값/정의점 계산)·주석·닫힌 윤곽(폴리라인·원·선/호 연결)·외곽/구멍 판정 → 분석만 저장. 두께 입력 후 `POST /files/:id/extrude` 로 돌출
5. 모델 저장: `models` 행(원본 파일 ID·버전 연결, 부품 트리·통계·형상 근거) + GLB + 기본 장면 v1

### 형상 근거(provenance) 구분
`drawing`(원본 도면 확인) · `user`(사용자 입력 확정) · `ai`(AI 추정, 현재 없음) · `unbuildable`(생성 불가: 열린 선분 등) — DXF 모델과 UI에 색상으로 표시.

## 4. 3D 엔진
- `web/src/engine/model.ts`: GLB 로드, partId→노드 매핑, 부품별 재질 복제(색상·투명도·강조), CAD Z-up → 뷰어 Y-up 변환, 부모 좌표계 보정 후 분해 이동
- `web/src/engine/stage.ts`: RoomEnvironment(PMREM) 환경광 — 외부 HDR 다운로드 없음(오프라인 동작), 그림자 바닥, 배경 4종, 기술 검토/홍보 모드
- `shared/scene.js`: 기본 분해 방향 제안, 단계별 진행, 타임라인(정지·분해·조립·회전 클립) 계산 — 서버/뷰어/렌더 공용

## 5. 렌더링 엔진 (MP4)
1. `POST /models/:id/renders {quality, fps}` → 현재 장면 버전 고정, render 작업 등록
2. 워커: Chromium(SwiftShader WebGL) 에 `/render?job&t=<30분 렌더 토큰>` 로드 → `frame(i)` 마다 장면 계산 → 자막·워터마크 합성 → JPEG
3. FFmpeg `image2pipe → libx264 yuv420p +faststart` → `companies/<cid>/videos/<id>.mp4` + 썸네일
4. 진행률·메시지·실패 원인·자동 재시도(기본 2회)·수동 재시도, 완료 시 다운로드 링크(Range 지원)
5. GPU 서버: 같은 이미지로 `RUN_WORKER=true` 인스턴스를 GPU 장비에 띄우고 웹 서버는 `RUN_WORKER=false` (같은 DB·저장소 공유)

## 6. 데이터베이스 (server/db/schema.sql)
companies · users · projects · upload_sessions · files · models · scenes(버전) · jobs · videos · share_links · share_visits · audit_logs

**회사별 격리 강제**: 모든 업무 테이블 `ENABLE + FORCE ROW LEVEL SECURITY`. 일반 요청은 트랜잭션마다 `SET LOCAL ROLE eum_app` + `app.company_id` 설정 후 실행(`server/db/index.js tenant()`) → 쿼리에 회사 조건이 빠져도 다른 회사 행은 조회·수정·삽입 불가. 시스템 범위(`system()`)는 회원가입·로그인 조회·공유토큰 조회·큐 선점에만 사용.
저장소 접근도 `companies/<회사ID>/` 접두사를 검사(`server/storage.js`).

지시서의 도면 객체·재질·치수·구속조건·키프레임·BOM 테이블은 2~3단계에서 추가 (현재 장면 JSON 에 분해·재질·카메라·클립 저장).

## 7. 보안
세션 JWT(httpOnly, SameSite=Lax, 운영 Secure) · bcrypt · 로그인 시도 제한 · 역할(admin/member/viewer) · 원본 다운로드는 내부 작성 권한 + 감사 로그 · 공유 링크: 추측 불가 토큰(96bit), 비밀번호(bcrypt)·만료·폐기·재발급, 원본 파일·경로 비노출 · 렌더 토큰은 해당 작업 모델만 읽기 · X-Frame-Options(공유 페이지만 iframe 허용) · 외부 AI API 전송 없음(`companies.external_ai_allowed` 기본 false).
