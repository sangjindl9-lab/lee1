# EUM 3D SHOWROOM PRO (이음 3D 쇼룸 프로)

AI 기반 CAD·PDF 3D 변환, 산업용 디지털 쇼룸 및 조립·분해 시뮬레이션 플랫폼 — **1단계 MVP**

**2D 도면만 올려도 바로 3D 쇼룸** — DXF·DWG·PDF·스캔 PDF·JPG·PNG·TIFF 도면을 올리면 투상도(정면·평면·측면)를 자동 인식해
**참고용 AI 3D 초안**을 만들고, 고객사 브랜드가 입혀진 **공유 URL(QR)** 과 **고객사 쇼룸(/c/주소)** 으로 바로 보여 줍니다.
STEP·IGES·STL·GLB 3D 원본은 형상 그대로 변환하며, 분해도·조립 애니메이션을 편집해 **MP4 동영상**으로 내보냅니다.

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
필요: Node 22, PostgreSQL 14+, FFmpeg, Poppler, Tesseract OCR(`tesseract-ocr-kor` 권장, 없어도 동작), LibreDWG(`dwg2dxf`), Chromium(`npx playwright-core install chromium`).

## 테스트
```bash
npm test                          # 통합 테스트 A~F (실제 서버·DB·렌더)
UI_BASE=http://localhost:8080 npm run test:ui   # 브라우저 UI 시나리오 (데스크톱 + 스마트폰)
python3 scripts/make_samples.py   # 샘플 CAD 재생성 (cadquery, ezdxf)
```

## 배포
- 온프레미스: `docker compose up -d` (외부 인터넷 불필요)
- 클라우드: Dockerfile 그대로 Railway 등에 배포, `/data` 볼륨 + PostgreSQL 연결
