# SHORTS FACTORY AI

주제 한 줄을 넣으면 조사 → 기획 → 대본 → 스토리보드 → 이미지·영상·음성 생성 → 편집 → 품질검수 → 업로드 패키지까지 17단계를 자동으로 진행하는 유튜브 쇼츠 제작 플랫폼.

```
frontend/   Next.js 14 + TypeScript + Tailwind (반응형, PWA)
backend/    FastAPI + SQLAlchemy(PostgreSQL) + Celery(Redis) + FFmpeg/OpenCV
  app/providers/   공급자 어댑터(Higgsfield, Claude/OpenAI/Gemini, ElevenLabs/OpenAI 음성, Tavily/Brave, YouTube)
  app/pipeline/    오케스트레이터, 17개 단계, 에이전트 지시문, 예산·멱등 처리
  app/media/       렌더링 엔진(FFmpeg), 자막(SRT/VTT/ASS), 기술 품질검수
  app/api/         REST + SSE
  alembic/         DB 마이그레이션 (27개 테이블)
  tests/           자동화 테스트 33개
docs/       API 설정 · 사용자 · 운영/장애복구 매뉴얼, 검증 결과와 미구현 목록
```

## 빠른 시작 (Docker)

```bash
cp .env.example .env        # SECRET_KEY, ENCRYPTION_KEY 를 반드시 바꿉니다
docker compose up -d --build
# 웹 http://localhost:3000   API http://localhost:8000/docs
# 관리자: admin / (.env 의 ADMIN_PASSWORD)
```
로그인 후 **API 연결 관리**에서 키를 등록하고 연결 테스트 → 모델 단가 입력 → 메인 화면에서 주제 입력.
제작이 끝까지 진행되려면 언어 AI 1개, 이미지 모델(Higgsfield 또는 OpenAI), 음성(ElevenLabs 또는 OpenAI)이 필요합니다.

## 개발 실행 (Docker 없이)

```bash
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
uvicorn app.main:app --reload            # SQLite + inline 모드(별도 워커 없이 동작)
pytest -q                                # ffmpeg, Noto Sans CJK 폰트 필요
cd ../frontend && npm install && npm run dev
```

## 구조 요약

- **웹 서버 / 파이프라인 워커 / 렌더링 워커 / beat** 가 분리돼 있어 렌더링 중에도 웹이 멈추지 않습니다.
- 단계 상태는 `projects.stage_state` 에 저장됩니다. 서버가 죽어도 완료 단계는 건너뛰고 실패 단계부터 다시 시작합니다.
- 유료 호출은 `provider_requests.idempotency_key`(프로젝트·장면·종류·모델·입력·시도번호의 해시)로 한 번만 실행되고,
  제출 후 중단된 요청은 외부 작업 ID로 이어서 조회합니다(재제출 없음).
- 유료 호출 직전마다 프로젝트·일·월 한도를 확인하고, 넘으면 과금 없이 `AWAITING_APPROVAL` 로 멈춥니다.
- 모델 ID·입력 스키마·단가는 코드가 아니라 `provider_models` 테이블에서 관리합니다.

검증한 것과 못 한 것은 [docs/검증결과_및_미구현.md](docs/검증결과_및_미구현.md)에 구분해 적었습니다.
