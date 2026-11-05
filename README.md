# EUM 3D STUDIO PRO

AI 기반 CAD·PDF 3D 변환, 산업용 디지털 쇼룸 및 조립·분해 시뮬레이션 플랫폼 — **1단계 MVP**

CAD 파일(STEP·IGES·STL·GLB·DXF)을 올리면 3D 모델과 부품 트리가 만들어지고, 분해도·조립 애니메이션을 편집해
**MP4 동영상**과 **공유 URL(QR)** 로 내보냅니다.

| 문서 | 내용 |
| --- | --- |
| [docs/구현현황.md](docs/구현현황.md) | 구현/미구현 구분, 테스트 결과 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 아키텍처·DB·변환 파이프라인·렌더 엔진 |
| [docs/API.md](docs/API.md) | REST API |
| [docs/사용자매뉴얼.md](docs/사용자매뉴얼.md) · [docs/관리자매뉴얼.md](docs/관리자매뉴얼.md) | 매뉴얼·설치 |

## 빠른 실행 (개발)
```bash
npm ci
npm run build                     # 웹 빌드 → web/dist
DATABASE_URL=postgres://postgres@localhost:5432/eum3d npm start   # http://localhost:8080
```
필요: Node 22, PostgreSQL 14+, FFmpeg, Chromium(`npx playwright-core install chromium`).

## 테스트
```bash
npm test                          # 통합 테스트 A~F (실제 서버·DB·렌더)
UI_BASE=http://localhost:8080 npm run test:ui   # 브라우저 UI 시나리오 (데스크톱 + 스마트폰)
python3 scripts/make_samples.py   # 샘플 CAD 재생성 (cadquery, ezdxf)
```

## 배포
- 온프레미스: `docker compose up -d` (외부 인터넷 불필요)
- 클라우드: Dockerfile 그대로 Railway 등에 배포, `/data` 볼륨 + PostgreSQL 연결
