# CCTV 설치 제안서

고객에게 "여기·여기에 CCTV를 설치합니다"를 보여주는 **고객용 제안서** 프로그램입니다. (설계 프로그램 `cctv-design`과 별개)

- 고객 집 평면도·배치도 사진·PDF를 올리고, 카메라를 클릭으로 배치
- 카메라마다 **화각(부채꼴)·촬영 거리·야간 거리** 표시, 주황 점을 끌어 방향·거리 조정
- 축척 맞추기(두 점 실제 길이) → 화각이 실제 비율로 그려짐
- 녹화기·모니터·배선 경로·문자 표시
- 견적(배치한 카메라 수량 자동 + 품목 추가, 할인, 부가세)
- **제안서 PDF**: 표지 / 설치 위치도(화각) / 카메라별 안내(현장 사진) / 견적 / 안내 사항 (A4·A3, 가로·세로)
- **고객 공유 링크**: 로그인 없이 휴대폰에서 보기 전용 (연락처 비공개, 언제든 중지)
- 직원 계정, 회사 정보·로고·안내 문구 설정, 카메라·품목 단가 관리

## 실행
```
npm ci && ADMIN_PASSWORD=비밀번호 npm start   # http://localhost:3000
```
환경변수: `PORT`, `DATA_DIR`(기본 ./data), `ADMIN_USER`, `ADMIN_PASSWORD`, `COMPANY_NAME`, `SESSION_SECRET`, `COOKIE_SECURE=1`(HTTPS), `SEED_SAMPLE=1`(샘플 제안서), `MAX_UPLOAD_MB`.
PDF 도면 사용 시 `poppler-utils`(pdftoppm) 필요 – Docker 이미지에 포함.

## Docker / Railway
`Dockerfile` 그대로 배포, 볼륨을 `/data`에 연결.
